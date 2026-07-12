/**
 * Tipos de conteúdo — categorias, temas e modos do Daily Debate.
 * Corresponde às seções 4 e 5 do design doc.
 */
export interface Category {
    id: string;
    name: string;
    icon: string;
    /**
     * Quando definido, TODO tema desta categoria força esse modo específico
     * (ex.: "História Inventada" sempre usa o modo "Invente"; "Opiniões
     * Polêmicas" e "Defender o Impossível" sempre usam "Defenda").
     * Quando ausente, o modo é sorteado livremente do pool geral.
     */
    forcedModeId?: string;
}
export interface ThemeDef {
    id: string;
    categoryId: string;
    text: string;
    /** peso relativo no sorteio — default 1. Útil pra calibrar o que aparece mais/menos. */
    weight?: number;
}
export interface ModeDef {
    id: string;
    name: string;
    description: string;
}
