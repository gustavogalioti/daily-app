"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawChallenge = drawChallenge;
const categories_1 = require("./categories");
const themes_1 = require("./themes");
const modes_1 = require("./modes");
const categoryById = new Map(categories_1.CATEGORIES.map((c) => [c.id, c]));
const allModesById = new Map([...modes_1.GENERAL_MODES, ...modes_1.FORCED_MODES].map((m) => [m.id, m]));
function pickWeighted(items) {
    const totalWeight = items.reduce((acc, i) => acc + (i.weight ?? 1), 0);
    let roll = Math.random() * totalWeight;
    for (const item of items) {
        roll -= item.weight ?? 1;
        if (roll <= 0)
            return item;
    }
    return items[items.length - 1];
}
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
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
function drawChallenge(usedThemeIds, options) {
    const categoryFilter = options?.categoryIds && options.categoryIds.length > 0 ? new Set(options.categoryIds) : null;
    const pool = categoryFilter ? themes_1.THEMES.filter((t) => categoryFilter.has(t.categoryId)) : themes_1.THEMES;
    const basePool = pool.length > 0 ? pool : themes_1.THEMES; // filtro vazio/inválido -> volta pro pool inteiro
    let available = basePool.filter((t) => !usedThemeIds.has(t.id));
    if (available.length < basePool.length * 0.2) {
        for (const t of basePool)
            usedThemeIds.delete(t.id);
        available = basePool;
    }
    const theme = pickWeighted(available);
    usedThemeIds.add(theme.id);
    const category = categoryById.get(theme.categoryId);
    if (!category) {
        throw new Error(`Tema '${theme.id}' referencia categoria inexistente '${theme.categoryId}'`);
    }
    const mode = category.forcedModeId ? allModesById.get(category.forcedModeId) : pickRandom(modes_1.GENERAL_MODES);
    if (!mode) {
        throw new Error(`Modo forçado '${category.forcedModeId}' não encontrado para categoria '${category.id}'`);
    }
    return {
        categoryId: category.id,
        categoryName: category.name,
        themeId: theme.id,
        themeText: theme.text,
        modeId: mode.id,
        modeName: mode.name,
        isInventedOnly: category.forcedModeId === "m_invente",
    };
}
