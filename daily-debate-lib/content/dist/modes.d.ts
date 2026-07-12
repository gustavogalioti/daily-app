import { ModeDef } from "./types";
/**
 * Modos "gerais" — sorteados livremente para qualquer categoria sem
 * forcedModeId. Combinados com o tema, multiplicam a variedade sem
 * precisar de mais conteúdo bruto (seção 5 do design doc).
 */
export declare const GENERAL_MODES: ModeDef[];
/**
 * Modos "forçados" — só aparecem quando a categoria do tema exige
 * (ver Category.forcedModeId em categories.ts). Não entram no sorteio livre.
 */
export declare const FORCED_MODES: ModeDef[];
export declare const ALL_MODES: ModeDef[];
