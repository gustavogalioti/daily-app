"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoundEngine = void 0;
exports.buildChallenge = buildChallenge;
const types_1 = require("./types");
const VALID_SCORES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
/**
 * RoundEngine — máquina de estados de UMA rodada do Daily Debate.
 *
 * Fluxo: sorteio -> preparacao -> apresentacao -> revelacao -> votacao -> encerrada
 * (ver design doc, seção 3 e 7.9)
 *
 * Princípios:
 *  - Puro: nenhuma chamada de rede/banco/timer real aqui. Quem injeta o
 *    tempo (`now`) e decide quando chamar `checkTimeouts` é a camada de
 *    servidor (seção 7.3/7.6 do design doc: "timer autoritativo no servidor").
 *  - Anti-cheat estrutural: `opinions` e `votes` só ficam visíveis para
 *    terceiros através de `getPublicState`, que aplica as regras de
 *    ocultação por fase — nunca expostos "crus".
 */
class RoundEngine {
    constructor(config, now) {
        // ---------- helpers internos ----------
        this.phaseOrder = [
            "sorteio",
            "preparacao",
            "apresentacao",
            "revelacao",
            "votacao",
            "encerrada",
        ];
        if (config.players.length < MIN_PLAYERS || config.players.length > MAX_PLAYERS) {
            throw new types_1.RoundError(`Número de jogadores inválido: ${config.players.length} (permitido ${MIN_PLAYERS}-${MAX_PLAYERS})`, "INVALID_TRANSITION");
        }
        if (!config.players.includes(config.presenterId)) {
            throw new types_1.RoundError("Apresentador não está na lista de jogadores", "UNKNOWN_PLAYER");
        }
        this.state = {
            roundNumber: config.roundNumber,
            presenterId: config.presenterId,
            players: config.players,
            challenge: config.challenge,
            status: "sorteio",
            prepEndsAt: null,
            presentationEndsAt: null,
            opinions: {},
            votes: {},
            result: null,
        };
        // durações ficam guardadas via closure para uso nas transições de timer
        this.prepDurationMs = config.prepDurationMs;
        this.presentationDurationMs = config.presentationDurationMs;
    }
    // ---------- transições de fase ----------
    /** sorteio -> preparacao */
    startPreparation(now) {
        this.assertStatus("sorteio");
        this.state.status = "preparacao";
        this.state.prepEndsAt = now + this.prepDurationMs;
    }
    /** preparacao -> apresentacao (manual ou via checkTimeouts) */
    startPresentation(now) {
        this.assertStatus("preparacao");
        this.state.status = "apresentacao";
        this.state.presentationEndsAt = now + this.presentationDurationMs;
    }
    /** apresentacao -> revelacao (apresentador encerra, ou via checkTimeouts) */
    endPresentation() {
        this.assertStatus("apresentacao");
        this.state.status = "revelacao";
    }
    /** revelacao -> votacao (chamado depois que o front terminou a animação de reveal) */
    openVoting() {
        this.assertStatus("revelacao");
        this.state.status = "votacao";
    }
    /** votacao -> encerrada. Calcula o resultado final da rodada. */
    finalizeRound() {
        this.assertStatus("votacao");
        const individualVotes = Object.values(this.state.votes);
        const sum = individualVotes.reduce((acc, v) => acc + v.score, 0);
        const average = individualVotes.length > 0
            ? Math.round((sum / individualVotes.length) * 10) / 10
            : 0;
        const result = {
            averageScore: average,
            individualVotes,
            opinions: Object.values(this.state.opinions),
        };
        this.state.status = "encerrada";
        this.state.result = result;
        return result;
    }
    /**
     * Avança fases automaticamente quando o prazo estourou.
     * Deve ser chamado periodicamente pelo servidor (ex.: a cada tick de 1s).
     * Retorna true se alguma transição automática ocorreu.
     */
    checkTimeouts(now) {
        if (this.state.status === "preparacao" && this.state.prepEndsAt !== null && now >= this.state.prepEndsAt) {
            this.startPresentation(now);
            return true;
        }
        if (this.state.status === "apresentacao" &&
            this.state.presentationEndsAt !== null &&
            now >= this.state.presentationEndsAt) {
            this.endPresentation();
            return true;
        }
        return false;
    }
    // ---------- ações dos jogadores ----------
    /** Frase secreta de um não-apresentador. Só durante 'preparacao'. */
    submitOpinion(playerId, text, now) {
        this.assertStatus("preparacao");
        this.assertKnownPlayer(playerId);
        if (playerId === this.state.presenterId) {
            throw new types_1.RoundError("Apresentador não escreve frase de opinião", "PRESENTER_CANNOT_ACT");
        }
        if (this.state.opinions[playerId]) {
            throw new types_1.RoundError("Jogador já enviou sua frase nesta rodada", "DUPLICATE_SUBMISSION");
        }
        if (!text.trim()) {
            throw new types_1.RoundError("Frase vazia não é permitida", "NOT_ALLOWED_IN_PHASE");
        }
        this.state.opinions[playerId] = { playerId, text: text.trim(), submittedAt: now };
    }
    /** Voto de 0.5 a 5.0. Só durante 'votacao'. */
    submitVote(voterId, score, now) {
        this.assertStatus("votacao");
        this.assertKnownPlayer(voterId);
        if (voterId === this.state.presenterId) {
            throw new types_1.RoundError("Apresentador não vota na própria apresentação", "PRESENTER_CANNOT_ACT");
        }
        if (!VALID_SCORES.includes(score)) {
            throw new types_1.RoundError(`Nota inválida: ${score}. Deve ser um dos valores ${VALID_SCORES.join(", ")}`, "INVALID_SCORE");
        }
        if (this.state.votes[voterId]) {
            throw new types_1.RoundError("Jogador já votou nesta rodada", "DUPLICATE_SUBMISSION");
        }
        this.state.votes[voterId] = { voterId, score, submittedAt: now };
    }
    /** true quando todos os jurados (todos exceto o apresentador) já votaram */
    allVotesIn() {
        const jurors = this.state.players.filter((p) => p !== this.state.presenterId);
        return jurors.every((p) => !!this.state.votes[p]);
    }
    /** true quando todos os não-apresentadores já enviaram a frase */
    allOpinionsIn() {
        const nonPresenters = this.state.players.filter((p) => p !== this.state.presenterId);
        return nonPresenters.every((p) => !!this.state.opinions[p]);
    }
    // ---------- leitura de estado (com ocultação por fase) ----------
    /**
     * Snapshot do estado, seguro para enviar a UM jogador específico
     * (`viewerId`). Aplica as regras de ocultação:
     *  - opinions: só aparecem completas quando status >= 'revelacao'
     *  - votes: cada jogador só vê o próprio voto até 'encerrada';
     *    em 'encerrada' todos ficam públicos (junto do resultado)
     */
    getPublicState(viewerId) {
        const revealPhaseOrLater = this.isAtOrAfter("revelacao");
        const closedRound = this.state.status === "encerrada";
        const opinions = revealPhaseOrLater ? Object.values(this.state.opinions) : [];
        const votes = closedRound
            ? Object.values(this.state.votes)
            : Object.values(this.state.votes).filter((v) => v.voterId === viewerId);
        return {
            roundNumber: this.state.roundNumber,
            presenterId: this.state.presenterId,
            players: this.state.players,
            challenge: this.state.challenge,
            status: this.state.status,
            prepEndsAt: this.state.prepEndsAt,
            presentationEndsAt: this.state.presentationEndsAt,
            opinions,
            votes,
            result: this.state.result,
            // metadados úteis pro front sem vazar conteúdo
            opinionsSubmittedCount: Object.keys(this.state.opinions).length,
            votesSubmittedCount: Object.keys(this.state.votes).length,
        };
    }
    isAtOrAfter(phase) {
        return this.phaseOrder.indexOf(this.state.status) >= this.phaseOrder.indexOf(phase);
    }
    assertStatus(expected) {
        if (this.state.status !== expected) {
            throw new types_1.RoundError(`Ação inválida: esperado status '${expected}', atual é '${this.state.status}'`, "INVALID_TRANSITION");
        }
    }
    assertKnownPlayer(playerId) {
        if (!this.state.players.includes(playerId)) {
            throw new types_1.RoundError(`Jogador desconhecido: ${playerId}`, "UNKNOWN_PLAYER");
        }
    }
}
exports.RoundEngine = RoundEngine;
function buildChallenge(partial) {
    return partial;
}
