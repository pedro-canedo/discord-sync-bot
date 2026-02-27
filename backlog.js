const path = require('path');
const fs = require('fs-extra');
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const OPEN_API_URL = process.env.OPEN_API_URL || 'https://api.openai.com/v1';
const OPEN_API_KEY = process.env.OPEN_API_KEY;
const BACKLOG_WEBHOOK_URL = process.env.BACKLOG_WEBHOOK_URL;

const BUG_MODAL_ID = 'backlog_bug_modal';
const DATA_DIR = path.join(__dirname, 'data');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'backlog-activities.json');
const BOARD_FILE = path.join(DATA_DIR, 'backlog-board.json');

const STATUS_OPEN = 'open';
const STATUS_IN_PROGRESS = 'in_progress';
const STATUS_COMPLETED = 'completed';

/** Carrega atividades (por guild). */
async function getActivities(guildId) {
    await fs.ensureDir(DATA_DIR);
    const data = await fs.readJSON(ACTIVITIES_FILE).catch(() => ([]));
    const list = Array.isArray(data) ? data : [];
    return guildId ? list.filter(a => a.guildId === guildId) : list;
}

/** Salva uma nova atividade ou atualiza existente. */
async function saveActivity(activity) {
    await fs.ensureDir(DATA_DIR);
    const list = await getActivities(null);
    const idx = list.findIndex(a => a.id === activity.id);
    if (idx >= 0) list[idx] = activity;
    else list.push(activity);
    await fs.writeJSON(ACTIVITIES_FILE, list, { spaces: 2 });
    return activity;
}

/** Atualiza apenas o status de uma atividade. */
async function updateActivityStatus(activityId, guildId, status) {
    const list = await getActivities(null);
    const a = list.find(x => x.id === activityId && x.guildId === guildId);
    if (!a) return null;
    a.status = status;
    await fs.writeJSON(ACTIVITIES_FILE, list, { spaces: 2 });
    return a;
}

/** Retorna quadro do guild: { channelId, messageId, webhookMessageId? }. */
async function getBoard(guildId) {
    const data = await fs.readJSON(BOARD_FILE).catch(() => ({}));
    return data[guildId] || null;
}

/** Salva referência do quadro do guild. setBoard(guildId, { channelId, messageId?, webhookMessageId? }) ou setBoard(guildId, channelId, messageId). */
async function setBoard(guildId, channelIdOrData, messageId) {
    await fs.ensureDir(DATA_DIR);
    const all = await fs.readJSON(BOARD_FILE).catch(() => ({}));
    const prev = all[guildId] || {};
    const data = typeof channelIdOrData === 'object' && channelIdOrData !== null
        ? channelIdOrData
        : { channelId: channelIdOrData, messageId };
    all[guildId] = { ...prev, ...data };
    await fs.writeJSON(BOARD_FILE, all, { spaces: 2 });
}

/** Envia mensagem via webhook (POST). Retorna { id } da mensagem ou null. */
async function sendWebhook(payload) {
    if (!BACKLOG_WEBHOOK_URL) return null;
    try {
        const body = typeof payload.embeds !== 'undefined'
            ? { ...payload, embeds: payload.embeds.map(e => (e && e.toJSON ? e.toJSON() : e)) }
            : payload;
        const res = await fetch(BACKLOG_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            console.error('Webhook POST falhou:', res.status, await res.text());
            return null;
        }
        const msg = await res.json();
        return msg.id ? { id: msg.id } : null;
    } catch (e) {
        console.error('Erro ao enviar webhook:', e);
        return null;
    }
}

/** Atualiza mensagem do webhook (PATCH). */
async function editWebhookMessage(messageId, payload) {
    if (!BACKLOG_WEBHOOK_URL || !messageId) return false;
    const url = `${BACKLOG_WEBHOOK_URL}/messages/${messageId}`;
    try {
        const body = typeof payload.embeds !== 'undefined'
            ? { ...payload, embeds: payload.embeds.map(e => (e && e.toJSON ? e.toJSON() : e)) }
            : payload;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            console.error('Webhook PATCH falhou:', res.status, await res.text());
            return false;
        }
        return true;
    } catch (e) {
        console.error('Erro ao editar mensagem do webhook:', e);
        return false;
    }
}

/**
 * Cria o modal para abertura de BUG (atividade de backlog).
 * Perguntas padrão no formato Scrum.
 */
function createBugModal() {
    const modal = new ModalBuilder()
        .setCustomId(BUG_MODAL_ID)
        .setTitle('🐛 Abrir BUG / Atividade de Backlog');

    const tituloInput = new TextInputBuilder()
        .setCustomId('titulo')
        .setLabel('Título do problema')
        .setPlaceholder('Ex: Kit não é concedido após linkar conta')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const descricaoInput = new TextInputBuilder()
        .setCustomId('descricao')
        .setLabel('Descrição do problema')
        .setPlaceholder('Descreva o que está acontecendo de forma objetiva.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

    const passosInput = new TextInputBuilder()
        .setCustomId('passos')
        .setLabel('Passos para reproduzir')
        .setPlaceholder('1. Fazer X\n2. Clicar em Y\n3. Observar Z')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

    const esperadoInput = new TextInputBuilder()
        .setCustomId('esperado_vs_atual')
        .setLabel('Comportamento esperado vs atual')
        .setPlaceholder('Esperado: ... | Atual: ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1024);

    const contextoInput = new TextInputBuilder()
        .setCustomId('contexto')
        .setLabel('Contexto / ambiente (opcional)')
        .setPlaceholder('Ex: Servidor X, navegador Chrome, após atualização')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(256);

    modal.addComponents(
        new ActionRowBuilder().addComponents(tituloInput),
        new ActionRowBuilder().addComponents(descricaoInput),
        new ActionRowBuilder().addComponents(passosInput),
        new ActionRowBuilder().addComponents(esperadoInput),
        new ActionRowBuilder().addComponents(contextoInput)
    );

    return modal;
}

/**
 * Chama a API OpenAI para refinar o texto do bug em um formato de atividade Scrum.
 */
async function refineWithLLM(titulo, descricao, passos, esperadoVsAtual, contexto) {
    if (!OPEN_API_KEY || !OPEN_API_URL) {
        return null;
    }

    const url = `${OPEN_API_URL.replace(/\/$/, '')}/chat/completions`;
    const body = {
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: `Você é um especialista em Scrum. Sua tarefa é transformar relatos de bug em atividades de backlog bem formatadas.
Retorne um JSON com as chaves: "titulo", "descricao", "criterios_aceitacao".
- titulo: frase curta e clara (estilo user story ou bug).
- descricao: parágrafo objetivo com contexto e impacto.
- criterios_aceitacao: array de strings, cada uma um critério de aceite claro e testável.
Mantenha o conteúdo fiel às informações fornecidas, apenas organizando e melhorando a redação. Responda apenas com o JSON, sem markdown.`
            },
            {
                role: 'user',
                content: [
                    `Título: ${titulo}`,
                    `Descrição: ${descricao}`,
                    `Passos para reproduzir: ${passos}`,
                    `Esperado vs Atual: ${esperadoVsAtual}`,
                    contexto ? `Contexto: ${contexto}` : ''
                ].filter(Boolean).join('\n\n')
            }
        ],
        temperature: 0.3,
        max_tokens: 1024
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPEN_API_KEY}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        console.error('OpenAI API error:', res.status, errText);
        return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    try {
        return JSON.parse(content);
    } catch {
        return null;
    }
}

/** Cor e emoji por status. */
function getStatusStyle(status) {
    switch (status) {
        case STATUS_IN_PROGRESS: return { color: 0xF39C12, label: '🔄 Em progresso' };
        case STATUS_COMPLETED: return { color: 0x27AE60, label: '✅ Concluído' };
        default: return { color: 0xE74C3C, label: '📋 To Do' };
    }
}

/** Botões para mudar status (To Do → In Progress → Completed). */
function buildActivityButtons(activityId, status) {
    const row = new ActionRowBuilder();
    if (status !== STATUS_IN_PROGRESS) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`backlog_${activityId}_in_progress`)
                .setLabel('Em progresso')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (status !== STATUS_COMPLETED) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`backlog_${activityId}_completed`)
                .setLabel('Concluído')
                .setStyle(ButtonStyle.Success)
        );
    }
    if (status === STATUS_IN_PROGRESS || status === STATUS_COMPLETED) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`backlog_${activityId}_open`)
                .setLabel('Voltar para To Do')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    return row.components.length ? new ActionRowBuilder().addComponents(row.components) : null;
}

/**
 * Monta embed da atividade de backlog (com ou sem refinamento LLM).
 * activity = { id, status } para incluir botões.
 */
function buildBacklogEmbed(author, raw, refined, activity = null) {
    const titulo = refined?.titulo ?? raw.titulo;
    const descricao = refined?.descricao ?? raw.descricao;
    const criterios = refined?.criterios_aceitacao;
    const status = activity?.status ?? STATUS_OPEN;
    const style = getStatusStyle(status);

    const embed = new EmbedBuilder()
        .setTitle(`${style.label} · ${titulo}`)
        .setColor(style.color)
        .setDescription(descricao)
        .setFooter({
            text: `Reportado por ${author?.tag ?? '?'}`,
            iconURL: author?.displayAvatarURL?.({ size: 32 })
        })
        .setTimestamp();

    if (Array.isArray(criterios) && criterios.length > 0) {
        embed.addFields({
            name: '✅ Critérios de aceitação',
            value: criterios.map((c, i) => `${i + 1}. ${c}`).join('\n')
        });
    }

    embed.addFields(
        { name: '📋 Passos para reproduzir', value: raw.passos || '-', inline: false },
        { name: '🔄 Esperado vs Atual', value: raw.esperado_vs_atual || '-', inline: false }
    );

    if (raw.contexto) {
        embed.addFields({ name: '📍 Contexto', value: raw.contexto, inline: true });
    }

    if (refined) {
        embed.addFields({
            name: '✨',
            value: 'Texto refinado com IA para formato Scrum.',
            inline: false
        });
    }

    return embed;
}

/** Reconstrói embed + botões a partir da atividade salva (para editar mensagem após mudança de status). */
function buildMessageFromActivity(activity) {
    const raw = {
        titulo: activity.titulo,
        descricao: activity.descricao,
        passos: activity.passos,
        esperado_vs_atual: activity.esperado_vs_atual,
        contexto: activity.contexto || ''
    };
    const refined = activity.criterios_aceitacao?.length
        ? { titulo: activity.titulo, descricao: activity.descricao, criterios_aceitacao: activity.criterios_aceitacao }
        : null;
    const author = { tag: activity.authorTag };
    const embed = buildBacklogEmbed(author, raw, refined, activity);
    const row = buildActivityButtons(activity.id, activity.status);
    return { embeds: [embed], components: row ? [row] : [] };
}

/** Monta o embed da lista todo (quadro) e atualiza no canal do bot e/ou no webhook. */
async function createOrUpdateBoard(client, guildId, channel) {
    const activities = await getActivities(guildId);
    const open = activities.filter(a => a.status === STATUS_OPEN);
    const inProgress = activities.filter(a => a.status === STATUS_IN_PROGRESS);
    const completed = activities.filter(a => a.status === STATUS_COMPLETED);

    const line = (list, empty) => {
        if (!list.length) return empty;
        return list.map((a, i) => `${i + 1}. ${a.titulo}`).join('\n');
    };
    const desc = [
        '**📋 To Do (Abertos)**',
        line(open, '_Nenhum_'),
        '',
        '**🔄 In Progress (Em progresso)**',
        line(inProgress, '_Nenhum_'),
        '',
        '**✅ Completed (Concluídos)**',
        line(completed, '_Nenhum_')
    ].join('\n').slice(0, 4096);

    const embed = new EmbedBuilder()
        .setTitle('📌 Backlog — Lista de atividades')
        .setDescription(desc)
        .setColor(0x3498DB)
        .setTimestamp();

    const board = await getBoard(guildId);

    if (client && channel) {
        try {
            if (board?.channelId && board?.messageId) {
                const ch = await client.channels.fetch(board.channelId).catch(() => null);
                const msg = ch ? await ch.messages.fetch(board.messageId).catch(() => null) : null;
                if (msg) {
                    await msg.edit({ embeds: [embed], components: [] });
                } else {
                    const sent = await channel.send({ embeds: [embed] });
                    await setBoard(guildId, { channelId: channel.id, messageId: sent.id });
                }
            } else {
                const sent = await channel.send({ embeds: [embed] });
                await setBoard(guildId, { channelId: channel.id, messageId: sent.id });
            }
        } catch (e) {
            console.error('Erro ao atualizar quadro backlog (canal):', e);
        }
    }

    if (BACKLOG_WEBHOOK_URL) {
        if (board?.webhookMessageId) {
            await editWebhookMessage(board.webhookMessageId, { embeds: [embed] });
        } else {
            const result = await sendWebhook({ embeds: [embed] });
            if (result?.id) {
                await setBoard(guildId, { webhookMessageId: result.id });
            }
        }
    }
}

/**
 * Trata o submit do modal de BUG: chama LLM, persiste atividade e envia embed com botões; atualiza quadro.
 */
async function handleBugModalSubmit(interaction, client) {
    if (interaction.customId !== BUG_MODAL_ID) return false;

    await interaction.deferReply({ ephemeral: true });

    const titulo = interaction.fields.getTextInputValue('titulo');
    const descricao = interaction.fields.getTextInputValue('descricao');
    const passos = interaction.fields.getTextInputValue('passos');
    const esperadoVsAtual = interaction.fields.getTextInputValue('esperado_vs_atual');
    const contexto = interaction.fields.getTextInputValue('contexto') || '';

    const raw = { titulo, descricao, passos, esperado_vs_atual: esperadoVsAtual, contexto };

    let refined = null;
    try {
        refined = await refineWithLLM(titulo, descricao, passos, esperadoVsAtual, contexto);
    } catch (err) {
        console.error('Erro ao chamar LLM para backlog:', err);
    }

    const backlogChannelId = process.env.BACKLOG_CHANNEL_ID;
    const channel = backlogChannelId
        ? interaction.guild?.channels.cache.get(backlogChannelId)
        : interaction.channel;

    if (!channel && !BACKLOG_WEBHOOK_URL) {
        await interaction.editReply({
            content: '❌ Configure `BACKLOG_CHANNEL_ID` ou `BACKLOG_WEBHOOK_URL` para publicar atividades.',
            ephemeral: true
        });
        return true;
    }

    const activityId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const tituloFinal = refined?.titulo ?? titulo;
    const activity = {
        id: activityId,
        guildId: interaction.guild.id,
        channelId: channel?.id ?? null,
        messageId: null,
        titulo: tituloFinal,
        descricao: refined?.descricao ?? descricao,
        criterios_aceitacao: refined?.criterios_aceitacao || [],
        passos,
        esperado_vs_atual: esperadoVsAtual,
        contexto,
        status: STATUS_OPEN,
        authorId: interaction.user.id,
        authorTag: interaction.user.tag,
        createdAt: new Date().toISOString()
    };
    await saveActivity(activity);

    const embed = buildBacklogEmbed(interaction.user, raw, refined, { id: activityId, status: STATUS_OPEN });

    if (channel) {
        const row = buildActivityButtons(activityId, STATUS_OPEN);
        const components = row ? [row] : [];
        const sent = await channel.send({ embeds: [embed], components });
        activity.messageId = sent.id;
        await saveActivity(activity);
    }

    if (BACKLOG_WEBHOOK_URL) {
        await sendWebhook({ embeds: [embed] });
    }

    await createOrUpdateBoard(client, interaction.guild.id, channel);

    await interaction.editReply({
        content: refined
            ? '✅ BUG registrado e texto refinado com IA. Atividade publicada e lista de backlog atualizada.'
            : '✅ BUG registrado e publicado. Lista de backlog atualizada. (IA indisponível; usado texto original.)',
        ephemeral: true
    });
    return true;
}

/**
 * Trata clique nos botões Em progresso / Concluído / Voltar para To Do.
 */
async function handleBacklogButton(interaction, client) {
    const customId = interaction.customId || '';
    const match = customId.match(/^backlog_(.+)_(open|in_progress|completed)$/);
    if (!match) return false;
    const [, activityId, newStatus] = match;

    await interaction.deferUpdate();

    const guildId = interaction.guild?.id;
    if (!guildId) return true;

    const updated = await updateActivityStatus(activityId, guildId, newStatus);
    if (!updated) {
        await interaction.followUp({ content: '❌ Atividade não encontrada.', ephemeral: true }).catch(() => {});
        return true;
    }

    const fullActivity = (await getActivities(null)).find(a => a.id === activityId && a.guildId === guildId);
    if (!fullActivity) return true;

    try {
        const ch = fullActivity.channelId ? await client.channels.fetch(fullActivity.channelId).catch(() => null) : null;
        const msg = ch && fullActivity.messageId ? await ch.messages.fetch(fullActivity.messageId).catch(() => null) : null;
        if (msg) {
            const payload = buildMessageFromActivity(fullActivity);
            await msg.edit(payload);
        }
    } catch (e) {
        console.error('Erro ao editar mensagem da atividade:', e);
    }

    const board = await getBoard(guildId);
    const ch = board?.channelId ? await client.channels.fetch(board.channelId).catch(() => null) : null;
    await createOrUpdateBoard(client, guildId, ch);

    return true;
}

/** Cria ou recria a mensagem do quadro de backlog no canal atual. */
async function setupBoardInChannel(interaction, client) {
    const channel = interaction.channel;
    const guildId = interaction.guild?.id;
    if (!guildId) return;

    const board = await getBoard(guildId);
    if (board?.channelId && board?.messageId) {
        try {
            const ch = await client.channels.fetch(board.channelId).catch(() => null);
            const msg = ch ? await ch.messages.fetch(board.messageId).catch(() => null) : null;
            if (msg) await msg.delete().catch(() => {});
        } catch (_) {}
    }
    await createOrUpdateBoard(client, guildId, channel);
}

module.exports = {
    BUG_MODAL_ID,
    createBugModal,
    handleBugModalSubmit,
    handleBacklogButton,
    setupBoardInChannel
};
