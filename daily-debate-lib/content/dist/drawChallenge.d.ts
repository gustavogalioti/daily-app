import { Challenge } from "@daily-debate/game-engine";
export interface DrawChallengeOptions {
    /** Se definido e não-vazio, sorteia apenas entre temas dessas categorias. */
    categoryIds?: string[];
}
/**
 * Sorteia Categoria + Tema + Modo, evitando repetir temas recentemente
 * usados (seção 7.4 do design doc).
 *
 * `usedThemeIds` é mantido pelo chamador (tipicamente por sala/partida) e
 * mutado in-place: o tema sorteado é adicionado automaticamente ao set.
 *
 * Quando o pool de temas ainda não usados fica pequeno (<20%), o
 * histórico é resetado (mas mantendo o próprio tema sorteado agora fora
 * dele) para não repetir o mesmo tema duas vezes seguidas mesmo assim.
 *
 * `options.categoryIds` permite ao host curar o conteúdo da sala (ex.:
 * tirar categorias sensíveis pra um grupo específico, ou focar em poucas
 * categorias). Se a lista ficar vazia/inválida, cai de volta pro pool
 * inteiro em vez de travar o sorteio.
 */
export declare function drawChallenge(usedThemeIds: Set<string>, options?: DrawChallengeOptions): Challenge;
