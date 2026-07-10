/**
 * Tipos centrais do Daily Debate game-engine.
 * Espelham as tabelas do design doc (seção 7.2), mas são tipos de domínio
 * puros — não sabem nada sobre banco de dados ou rede.
 */
export type PlayerId = string;
/** Máquina de estados da rodada — ver design doc seção 3 e 7.9 */
export type RoundStatus = "sorteio" | "preparacao" | "apresentacao" | "revelacao" | "votacao" | "encerrada";
export interface Challenge {
    categoryId: string;
    categoryName: string;
    themeId: string;
    themeText: string;
    modeId: string;
    modeName: string;
    /** true quando o tema já força o modo "Invente"/"Mentiroso Profissional" */
    isInventedOnly: boolean;
}
export interface Opinion {
    playerId: PlayerId;
    text: string;
    submittedAt: number;
}
export interface Vote {
    voterId: PlayerId;
    score: number;
    submittedAt: number;
}
export interface RoundConfig {
    roundNumber: number;
    presenterId: PlayerId;
    players: PlayerId[];
    challenge: Challenge;
    /** durações em ms — injetáveis para facilitar testes */
    prepDurationMs: number;
    presentationDurationMs: number;
}
export interface RoundState {
    roundNumber: number;
    presenterId: PlayerId;
    players: PlayerId[];
    challenge: Challenge;
    status: RoundStatus;
    prepEndsAt: number | null;
    presentationEndsAt: number | null;
    /** ocultas até status === 'revelacao' */
    opinions: Record<PlayerId, Opinion>;
    votes: Record<PlayerId, Vote>;
    /** preenchido quando a rodada é encerrada */
    result: RoundResult | null;
}
export interface RoundResult {
    averageScore: number;
    individualVotes: Vote[];
    opinions: Opinion[];
}
export declare class RoundError extends Error {
    code: "INVALID_TRANSITION" | "NOT_ALLOWED_IN_PHASE" | "PRESENTER_CANNOT_ACT" | "DUPLICATE_SUBMISSION" | "INVALID_SCORE" | "UNKNOWN_PLAYER";
    constructor(message: string, code: "INVALID_TRANSITION" | "NOT_ALLOWED_IN_PHASE" | "PRESENTER_CANNOT_ACT" | "DUPLICATE_SUBMISSION" | "INVALID_SCORE" | "UNKNOWN_PLAYER");
}
