"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_MODES = exports.FORCED_MODES = exports.GENERAL_MODES = void 0;
/**
 * Modos "gerais" — sorteados livremente para qualquer categoria sem
 * forcedModeId. Combinados com o tema, multiplicam a variedade sem
 * precisar de mais conteúdo bruto (seção 5 do design doc).
 */
exports.GENERAL_MODES = [
    { id: "m_professor", name: "Professor", description: "Explique o tema como se fosse um especialista" },
    { id: "m_ted", name: "TED Talk", description: "Faça uma palestra inspiradora sobre o tema" },
    { id: "m_podcast", name: "Podcast", description: "Explique como se estivesse apresentando um podcast" },
    { id: "m_jornal", name: "Jornal", description: "Apresente como um jornalista no telejornal" },
    { id: "m_advogado", name: "Advogado", description: "Defenda um lado específico como um advogado" },
    { id: "m_vendedor", name: "Vendedor", description: "Venda a ideia como se fosse um comercial" },
    { id: "m_tribunal", name: "Tribunal", description: "Convença um júri" },
    { id: "m_standup", name: "Stand-up", description: "Explique tudo fazendo humor" },
];
/**
 * Modos "forçados" — só aparecem quando a categoria do tema exige
 * (ver Category.forcedModeId em categories.ts). Não entram no sorteio livre.
 */
exports.FORCED_MODES = [
    { id: "m_invente", name: "Invente", description: "Não precisa ser verdade — invente uma história convincente" },
    { id: "m_defenda", name: "Defenda", description: "Defenda esse ponto de vista, mesmo que não concorde com ele" },
];
exports.ALL_MODES = [...exports.GENERAL_MODES, ...exports.FORCED_MODES];
