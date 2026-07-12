import { Challenge, Opinion, PlayerId, RoundConfig, RoundResult, RoundStatus, Vote } from "./types";
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
export declare class RoundEngine {
    private state;
    constructor(config: RoundConfig, now: number);
    private prepDurationMs;
    private presentationDurationMs;
    /** sorteio -> preparacao */
    startPreparation(now: number): void;
    /** preparacao -> apresentacao (manual ou via checkTimeouts) */
    startPresentation(now: number): void;
    /** apresentacao -> revelacao (apresentador encerra, ou via checkTimeouts) */
    endPresentation(): void;
    /** revelacao -> votacao (chamado depois que o front terminou a animação de reveal) */
    openVoting(): void;
    /** votacao -> encerrada. Calcula o resultado final da rodada. */
    finalizeRound(): RoundResult;
    /**
     * Avança fases automaticamente quando o prazo estourou.
     * Deve ser chamado periodicamente pelo servidor (ex.: a cada tick de 1s).
     * Retorna true se alguma transição automática ocorreu.
     */
    checkTimeouts(now: number): boolean;
    /** Frase secreta de um não-apresentador. Só durante 'preparacao'. */
    submitOpinion(playerId: PlayerId, text: string, now: number): void;
    /** Voto de 0.5 a 5.0. Só durante 'votacao'. */
    submitVote(voterId: PlayerId, score: number, now: number): void;
    /** true quando todos os jurados (todos exceto o apresentador) já votaram */
    allVotesIn(): boolean;
    /** true quando todos os não-apresentadores já enviaram a frase */
    allOpinionsIn(): boolean;
    /**
     * Snapshot do estado, seguro para enviar a UM jogador específico
     * (`viewerId`). Aplica as regras de ocultação:
     *  - opinions: só aparecem completas quando status >= 'revelacao'
     *  - votes: cada jogador só vê o próprio voto até 'encerrada';
     *    em 'encerrada' todos ficam públicos (junto do resultado)
     */
    getPublicState(viewerId: PlayerId): {
        roundNumber: number;
        presenterId: string;
        players: string[];
        challenge: Challenge;
        status: RoundStatus;
        prepEndsAt: number | null;
        presentationEndsAt: number | null;
        opinions: Opinion[];
        votes: Vote[];
        result: RoundResult | null;
        opinionsSubmittedCount: number;
        votesSubmittedCount: number;
    };
    private phaseOrder;
    private isAtOrAfter;
    private assertStatus;
    private assertKnownPlayer;
}
export declare function buildChallenge(partial: Challenge): Challenge;
