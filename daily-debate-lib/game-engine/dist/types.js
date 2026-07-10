"use strict";
/**
 * Tipos centrais do Daily Debate game-engine.
 * Espelham as tabelas do design doc (seção 7.2), mas são tipos de domínio
 * puros — não sabem nada sobre banco de dados ou rede.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoundError = void 0;
class RoundError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "RoundError";
    }
}
exports.RoundError = RoundError;
