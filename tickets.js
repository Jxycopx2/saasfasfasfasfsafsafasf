require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const {
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActivityType,
    Status,
} = require('discord.js');

const TICKET_BOT_TOKEN = process.env.TICKET_BOT_TOKEN || process.env.BOT_TOKEN_2;
const CLIENT_ID = process.env.TICKET_CLIENT_ID || process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || '1554125892329017366';

const WEB_PORT = process.env.WEB_PORT || 3000;
const WEB_BASE_URL = process.env.WEB_BASE_URL || `http://localhost:${WEB_PORT}`;

const TICKET_CATEGORY_IDS = {
    purchase: process.env.TICKET_CATEGORY_PURCHASE || '',
    middleman: process.env.TICKET_CATEGORY_MIDDLEMAN || '',
    general: process.env.TICKET_CATEGORY_GENERAL || '',
};
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '';

const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || '';
const STAFF_ROLE_IDS = (process.env.STAFF_ROLE_IDS || '').split(',').filter(Boolean);

const TICKET_PREFIX = 'ticket-';
const MAX_TICKETS_PER_USER = 3;

const EMOJIS = {
    purchase: { name: '32877animatedarrowbluelite', id: '1542850802966601849' },
    middleman: { name: '91490animatedarrowblue', id: '1542851262083502080' },
    general: { name: '15072animatedarrowpink2', id: '1542851211651452948' },
    create: { name: '129636pinkbunnybroken', id: '1549498465191591936' },
    myList: { name: '177869pinkbunnysweat', id: '1549498480672776365' },
    claim: { name: '291197pinkbunnyclap', id: '1549498511685455952' },
    transcript: { name: '357726pinkbunnyshy', id: '1549498563896016977' },
    close: { name: '699622289376804917', id: '1363251868347928801' },
};

if (!TICKET_BOT_TOKEN) {
    console.error('❌ กรุณาตั้งค่า TICKET_BOT_TOKEN ในไฟล์ .env');
    process.exit(1);
}

const COLORS = {
    primary: 0x6366f1,
    success: 0x10b981,
    danger: 0xf43f5e,
    warning: 0xfbbf24,
    info: 0x00f0ff,
    gold: 0xfbbf24,
    purple: 0xc084fc,
};

const TICKET_TYPES = [
    {
        id: 'purchase',
        label: 'ติดต่อซื้อของ',
        description: 'สั่งซื้อสินค้า / สอบถามราคา',
        emoji: EMOJIS.purchase,
        color: COLORS.success,
        intro: 'กรุณาแจ้งรายการสินค้าที่ต้องการซื้อ + จำนวน + ช่องทางชำระเงิน',
    },
    {
        id: 'middleman',
        label: 'กลางของ',
        description: 'ใช้บริการกลางของ / ฝากซื้อ-ขาย',
        emoji: EMOJIS.middleman,
        color: COLORS.gold,
        intro: 'กรุณาแจ้งรายละเอียดสินค้า + คู่ค้า + ราคาที่ตกลงกัน',
    },
    {
        id: 'general',
        label: 'สอบถามทั่วไป',
        description: 'สอบถามข้อมูลทั่วไป',
        emoji: EMOJIS.general,
        color: COLORS.info,
        intro: 'กรุณาพิมพ์คำถามที่ต้องการสอบถามได้เลย ทีมงานจะตอบโดยเร็วที่สุด',
    },
];

const TRANSCRIPT_DIR = path.join(__dirname, 'transcripts');
const INDEX_FILE = path.join(TRANSCRIPT_DIR, 'index.json');

if (!fs.existsSync(TRANSCRIPT_DIR)) fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, JSON.stringify({ transcripts: [] }, null, 2));

function generateId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function saveTranscript({ html, channelName, ownerTag, ownerId, messageCount, ticketType }) {
    const id = generateId();
    fs.writeFileSync(path.join(TRANSCRIPT_DIR, `${id}.html`), html, 'utf-8');

    let data = { transcripts: [] };
    try { data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch { }

    data.transcripts.push({
        id, channelName, ownerTag, ownerId, messageCount, ticketType,
        createdAt: Date.now(),
    });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));

    return { id, url: `${WEB_BASE_URL}/transcript/${id}` };
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildTranscriptHtml({ channel, messages, owner }) {
    const total = messages.length;
    const firstMsg = messages[0];
    const createdTs = firstMsg ? firstMsg.createdTimestamp : Date.now();

    const messagesHtml = messages.map(m => {
        const time = new Date(m.createdTimestamp).toLocaleString('th-TH', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        const avatar = m.author.displayAvatarURL({ extension: 'png', size: 64 });
        const isBot = m.author.bot;

        let contentHtml = '';
        if (m.content) {
            contentHtml += `<div class="text">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>`;
        }
        if (m.attachments && m.attachments.size > 0) {
            m.attachments.forEach(att => {
                const isImage = /\.(png|jpe?g|gif|webp)$/i.test(att.name || '');
                if (isImage) {
                    contentHtml += `<div class="attachment"><img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.name)}" loading="lazy"></div>`;
                } else {
                    contentHtml += `<div class="attachment"><a href="${escapeHtml(att.url)}" target="_blank">📎 ${escapeHtml(att.name)}</a></div>`;
                }
            });
        }
        if (m.embeds && m.embeds.length > 0) {
            m.embeds.forEach(emb => {
                contentHtml += `<div class="embed">`;
                if (emb.title) contentHtml += `<div class="embed-title">${escapeHtml(emb.title)}</div>`;
                if (emb.description) contentHtml += `<div class="embed-desc">${escapeHtml(emb.description).replace(/\n/g, '<br>')}</div>`;
                contentHtml += `</div>`;
            });
        }
        if (!contentHtml) contentHtml = `<div class="text muted">[ไม่มีข้อความ]</div>`;

        return `
        <div class="message ${isBot ? 'bot' : ''}">
            <img class="avatar" src="${avatar}" alt="avatar">
            <div class="body">
                <div class="header">
                    <span class="author">${escapeHtml(m.author.tag)}</span>
                    ${isBot ? '<span class="badge">BOT</span>' : ''}
                    <span class="time">${time}</span>
                </div>
                <div class="content">${contentHtml}</div>
            </div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transcript - ${escapeHtml(channel.name)}</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #1e1f22; color: #dbdee1; line-height: 1.5; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; background: #2b2d31; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .header { background: linear-gradient(135deg, #6366f1, #c084fc); padding: 24px; color: #fff; }
    .header h1 { font-size: 22px; margin-bottom: 6px; }
    .header .meta { font-size: 13px; opacity: 0.9; }
    .header .meta span { margin-right: 16px; }
    .messages { padding: 16px; }
    .message { display: flex; gap: 12px; padding: 10px 12px; border-radius: 8px; margin-bottom: 4px; }
    .message:hover { background: #313338; }
    .message.bot { background: rgba(99,102,241,0.06); }
    .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; object-fit: cover; }
    .body { flex: 1; min-width: 0; }
    .message .header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
    .author { font-weight: 600; color: #fff; font-size: 15px; }
    .badge { background: #5865f2; color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 700; }
    .time { font-size: 12px; color: #949ba4; }
    .content { font-size: 14px; color: #dbdee1; word-wrap: break-word; }
    .text.muted { color: #6d6f78; font-style: italic; }
    .attachment { margin-top: 8px; }
    .attachment img { max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid #1e1f22; }
    .attachment a { display: inline-block; background: #1e1f22; padding: 6px 12px; border-radius: 6px; color: #00a8fc; text-decoration: none; font-size: 13px; }
    .embed { margin-top: 8px; padding: 10px 12px; background: #1e1f22; border-left: 4px solid #6366f1; border-radius: 4px; }
    .embed-title { font-weight: 600; color: #fff; margin-bottom: 4px; }
    .embed-desc { font-size: 13px; color: #b5bac1; }
    .footer { text-align: center; padding: 16px; font-size: 12px; color: #6d6f78; border-top: 1px solid #1e1f22; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>📄 Ticket Transcript</h1>
        <div class="meta">
            <span>📁 <strong>${escapeHtml(channel.name)}</strong></span>
            <span>👤 เจ้าของ: <strong>${escapeHtml(owner.tag)}</strong></span>
            <span>💬 ${total} ข้อความ</span>
            <span>🕐 เปิดเมื่อ: ${new Date(createdTs).toLocaleString('th-TH')}</span>
        </div>
    </div>
    <div class="messages">${messagesHtml}</div>
    <div class="footer">สร้างโดยระบบ Ticket • ${new Date().toLocaleString('th-TH')}</div>
</div>
</body>
</html>`;
}

function buildTicketPanel() {
    return {
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: COLORS.primary,
                components: [
                    {
                        type: 9,
                        components: [{ type: 10, content: '# \`🎫\`  **TICKET SYSTEM**' }],
                        accessory: { type: 11, media: { url: 'https://i.pinimg.com/1200x/a4/78/cf/a478cf80cbdcc1f9a7bdc7f9f32d72c6.jpg' } }
                    },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `-  **ติดต่อซื้อของ** — สั่งซื้อสินค้า / สอบถามราคา\n\n` +
                            `-  **กลางของ** — ใช้บริการกลางของ ฝากซื้อ-ขาย\n\n` +
                            `-   **สอบถามทั่วไป** — สอบถามข้อมูลต่างๆ`
                    },
                    { type: 14, divider: false, spacing: 2 },
                    {
                        type: 1,
                        components: [
                            {
                                type: 2, style: 1, label: 'เปิด Ticket',
                                emoji: { animated: true, name: EMOJIS.create.name, id: EMOJIS.create.id },
                                custom_id: 'ticket_create',
                            },
                            {
                                type: 2, style: 2, label: 'ดู Ticket ของฉัน',
                                emoji: { animated: true, name: EMOJIS.myList.name, id: EMOJIS.myList.id },
                                custom_id: 'ticket_my_list',
                            },
                        ]
                    }
                ]
            }
        ]
    };
}

function buildTypeSelectMessage() {
    return {
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: COLORS.primary,
                components: [
                    { type: 10, content: '# \`🎫\` เลือกประเภท Ticket\n**กรุณาเลือกหัวข้อที่ต้องการติดต่อ**' },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `-  **ติดต่อซื้อของ** — สั่งซื้อสินค้า / สอบถามราคา\n\n` +
                            `-  **กลางของ** — ใช้บริการกลางของ ฝากซื้อ-ขาย\n\n` +
                            `-  **สอบถามทั่วไป** — สอบถามข้อมูลต่างๆ`
                    },
                    { type: 14, divider: false, spacing: 2 },
                    {
                        type: 1,
                        components: [
                            {
                                type: 3,
                                custom_id: 'ticket_type_select',
                                placeholder: '📋 เลือกประเภท Ticket ที่ต้องการ...',
                                options: TICKET_TYPES.map(t => ({
                                    label: t.label,
                                    description: t.description,
                                    value: t.id,
                                    emoji: { animated: true, name: t.emoji.name, id: t.emoji.id }
                                }))
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

function buildTicketWelcome({ user, typeInfo, ticketNumber }) {
    return {
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: typeInfo.color,
                components: [
                    {
                        type: 9,
                        components: [{ type: 10, content: `# ${typeInfo.label}\n\n- **Ticket #${ticketNumber} จาก <@${user.id}>**` }],
                        accessory: { type: 11, media: { url: user.displayAvatarURL({ dynamic: true, size: 256 }) } }
                    },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `- สวัสดี <@${user.id}> \`👋\` \n\n` +
                            `- ${typeInfo.intro}\n\n` +
                            `- \`⏱️\` **ทีมงานจะตอบกลับโดยเร็วที่สุด**`
                    },
                    { type: 14, divider: false, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `- \`👤\` **ผู้เปิด:** <@${user.id}>\n\n` +
                            `- \`📁\` **ประเภท:** ${typeInfo.label}\n\n` +
                            `- \`🔢\` **Ticket #:** ${ticketNumber}\n\n` +
                            `- \`🕐\` **เวลา:** <t:${Math.floor(Date.now() / 1000)}:R>`
                    },
                    { type: 14, divider: false, spacing: 2 },
                    {
                        type: 1,
                        components: [
                            {
                                type: 2, style: 3, label: 'รับเรื่อง',
                                emoji: { animated: true, name: EMOJIS.claim.name, id: EMOJIS.claim.id },
                                custom_id: 'ticket_claim',
                            },
                            {
                                type: 2, style: 2, label: 'บันทึกบทสนทนา',
                                emoji: { animated: true, name: EMOJIS.transcript.name, id: EMOJIS.transcript.id },
                                custom_id: 'ticket_transcript',
                            },
                            {
                                type: 2, style: 4, label: 'ปิด Ticket',
                                emoji: { animated: true, name: EMOJIS.close.name, id: EMOJIS.close.id },
                                custom_id: 'ticket_close',
                            },
                        ]
                    }
                ]
            }
        ]
    };
}

function getCategoryIdForType(typeId) {
    if (TICKET_CATEGORY_IDS[typeId]) return TICKET_CATEGORY_IDS[typeId];
    return TICKET_CATEGORY_ID || null;
}

async function ensureCategory(guild, typeInfo) {
    const existingId = getCategoryIdForType(typeInfo.id);
    if (existingId) {
        const existing = guild.channels.cache.get(existingId);
        if (existing) return existing;
    }

    try {
        const category = await guild.channels.create({
            name: `🎫 ${typeInfo.label}`,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                ...STAFF_ROLE_IDS.map(roleId => ({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                })),
            ],
        });
        console.log(`✅ สร้าง category "${typeInfo.label}" อัตโนมัติ: ${category.id}`);
        return category;
    } catch (err) {
        console.error('Create category error:', err.message);
        return null;
    }
}

function getNextTicketNumber(guild) {
    let maxNum = 0;
    guild.channels.cache.forEach(ch => {
        if (ch.name && ch.name.startsWith(TICKET_PREFIX)) {
            const match = ch.name.match(/^ticket-(\d+)/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
    });
    return maxNum + 1;
}

function formatTicketNumber(num) {
    return String(num).padStart(3, '0');
}

async function createTicketChannel(interaction, ticketTypeId) {
    const guild = interaction.guild;
    const user = interaction.user;
    const typeInfo = TICKET_TYPES.find(t => t.id === ticketTypeId) || TICKET_TYPES[0];

    const existingChannels = guild.channels.cache.filter(ch =>
        ch.name.startsWith(TICKET_PREFIX) &&
        ch.type === ChannelType.GuildText &&
        ch.permissionOverwrites.cache.has(user.id)
    );

    if (existingChannels.size >= MAX_TICKETS_PER_USER) {
        throw new Error(`คุณมี Ticket เปิดอยู่แล้ว ${existingChannels.size} ห้อง (สูงสุด ${MAX_TICKETS_PER_USER} ห้อง)\nกรุณาปิด Ticket เก่าก่อน`);
    }

    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
    ];

    STAFF_ROLE_IDS.forEach(roleId => {
        permissionOverwrites.push({
            id: roleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        });
    });

    const ticketNumber = getNextTicketNumber(guild);
    const ticketNumberStr = formatTicketNumber(ticketNumber);
    const username = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15) || 'user';

    const channelOptions = {
        name: `${TICKET_PREFIX}${ticketNumberStr}-${username}`,
        type: ChannelType.GuildText,
        permissionOverwrites,
        topic: `Ticket #${ticketNumberStr} ของ ${user.tag} ประเภท: ${typeInfo.label}`,
    };

    const category = await ensureCategory(guild, typeInfo);
    if (category) channelOptions.parent = category.id;

    const ticketChannel = await guild.channels.create(channelOptions);

    await ticketChannel.send(buildTicketWelcome({ user, typeInfo, ticketNumber: ticketNumberStr }));

    if (TICKET_LOG_CHANNEL_ID) {
        try {
            const logCh = await client.channels.fetch(TICKET_LOG_CHANNEL_ID);
            if (logCh) {
                await logCh.send({
                    flags: 32768,
                    components: [
                        {
                            type: 17,
                            accent_color: typeInfo.color,
                            components: [
                                { type: 10, content: `# 🎫 Ticket ใหม่ #${ticketNumberStr}\n**<@${user.id}> เปิด Ticket**` },
                                { type: 14, divider: true, spacing: 1 },
                                {
                                    type: 10,
                                    content:
                                        `- \`👤\` **ผู้เปิด:** <@${user.id}>\n` +
                                        `- \`🔢\` **Ticket #:** ${ticketNumberStr}\n` +
                                        `- \`📁\` **ประเภท:**  ${typeInfo.label}\n` +
                                        `-  **ห้อง:** <#${ticketChannel.id}>`
                                }
                            ]
                        }
                    ]
                });
            }
        } catch (err) {
            console.error('Log error:', err.message);
        }
    }

    return ticketChannel;
}

async function closeTicket(interaction) {
    const channel = interaction.channel;
    if (!channel.name.startsWith(TICKET_PREFIX)) {
        return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
    }

    await interaction.reply({ content: '🔒 กำลังปิด Ticket... ระบบจะลบห้องใน 5 วินาที' });

    setTimeout(async () => {
        try { await channel.delete(`Ticket closed by ${interaction.user.tag}`); }
        catch (err) { console.error('Delete channel error:', err.message); }
    }, 5000);
}

async function listMyTickets(interaction) {
    const guild = interaction.guild;
    const user = interaction.user;

    const myTickets = guild.channels.cache.filter(ch =>
        ch.name.startsWith(TICKET_PREFIX) &&
        ch.type === ChannelType.GuildText &&
        ch.permissionOverwrites.cache.has(user.id)
    );

    if (myTickets.size === 0) {
        return interaction.reply({
            flags: 32768 | 64,
            components: [
                {
                    type: 17,
                    accent_color: COLORS.info,
                    components: [
                        { type: 10, content: '# \`📭\` **ยังไม่มี Ticket**\n**คุณยังไม่มี Ticket ที่เปิดอยู่**' }
                    ]
                }
            ]
        });
    }

    const ticketLines = myTickets.map(ch =>
        `> • <#${ch.id}> — <t:${Math.floor(ch.createdTimestamp / 1000)}:R>`
    ).join('\n');

    return interaction.reply({
        flags: 32768 | 64,
        components: [
            {
                type: 17,
                accent_color: COLORS.info,
                components: [
                    { type: 10, content: `# \`📋\` **Ticket ของคุณ**\n**ทั้งหมด ${myTickets.size} ห้อง**` },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: ticketLines }
                ]
            }
        ]
    });
}

async function claimTicket(interaction) {
    const channel = interaction.channel;
    const member = interaction.member;

    if (!channel.name.startsWith(TICKET_PREFIX)) {
        return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
    }

    const isStaff = STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isStaff && !isAdmin) {
        return interaction.reply({ content: '❌ เฉพาะทีมงานเท่านั้นที่รับเรื่องได้', ephemeral: true });
    }

    return interaction.reply({
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: COLORS.success,
                components: [
                    { type: 10, content: `# \`✋\` **รับเรื่องแล้ว**\n**<@${member.id}> รับผิดชอบ Ticket นี้**` }
                ]
            }
        ]
    });
}

async function fetchAllMessages(channel, maxMessages = 2000) {
    const allMessages = [];
    let lastId = null;

    while (allMessages.length < maxMessages) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;

        allMessages.push(...fetched.values());
        lastId = fetched.last().id;
        if (fetched.size < 100) break;
    }

    return allMessages.reverse();
}

async function transcriptTicket(interaction) {
    const channel = interaction.channel;
    if (!channel.name.startsWith(TICKET_PREFIX)) {
        return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const sorted = await fetchAllMessages(channel, 2000);

    const botId = client.user.id;
    const ownerOverwrite = channel.permissionOverwrites.cache.find(
        ow =>
            ow.type === 1 &&
            ow.id !== botId &&
            !STAFF_ROLE_IDS.includes(ow.id) &&
            ow.allow.has(PermissionFlagsBits.ViewChannel)
    );

    if (!ownerOverwrite) {
        return interaction.editReply({ content: '❌ ไม่พบเจ้าของ Ticket ไม่สามารถส่ง DM ได้' });
    }

    const ownerId = ownerOverwrite.id;

    try {
        const owner = await client.users.fetch(ownerId);

        const html = buildTranscriptHtml({ channel, messages: sorted, owner });

        const typeMatch = channel.name.match(/^ticket-\d+-(\w+)/);
        const ticketType = typeMatch ? typeMatch[1] : 'unknown';

        const { url } = saveTranscript({
            html,
            channelName: channel.name,
            ownerTag: owner.tag,
            ownerId: owner.id,
            messageCount: sorted.length,
            ticketType,
        });

        await owner.send({
            content:
                `📄 **บันทึกบทสนทนา Ticket**\n` +
                `> 📁 ห้อง: \`${channel.name}\`\n` +
                `> 💬 จำนวน: \`${sorted.length}\` ข้อความ\n\n` +
                `🔗 **ลิงก์ดูบันทึก:** ${url}`,
        });

        return interaction.editReply({
            content: `✅ ส่งลิงก์บันทึกไปที่ DM ของ <@${ownerId}> แล้ว\n🔗 ${url}`,
        });
    } catch (err) {
        console.error('Transcript error:', err.message);
        return interaction.editReply({
            content: `❌ ไม่สามารถส่ง DM ไปหา <@${ownerId}> ได้ (อาจปิดรับข้อความจากเซิร์ฟเวอร์)`,
        });
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ticket-panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ เฉพาะแอดมินเท่านั้น', ephemeral: true });
                }
                await interaction.channel.send(buildTicketPanel());
                return interaction.reply({ content: '✅ ส่งแผง Ticket สำเร็จ!', ephemeral: true });
            }

            if (interaction.commandName === 'ticket-close') return closeTicket(interaction);

            if (interaction.commandName === 'ticket-add') {
                const targetUser = interaction.options.getUser('user');
                const channel = interaction.channel;
                if (!channel.name.startsWith(TICKET_PREFIX)) {
                    return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
                }
                await channel.permissionOverwrites.edit(targetUser.id, {
                    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
                });
                return interaction.reply({ content: `✅ เพิ่ม <@${targetUser.id}> เข้า Ticket แล้ว` });
            }

            if (interaction.commandName === 'ticket-remove') {
                const targetUser = interaction.options.getUser('user');
                const channel = interaction.channel;
                if (!channel.name.startsWith(TICKET_PREFIX)) {
                    return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
                }
                await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: false });
                return interaction.reply({ content: `✅ ลบ <@${targetUser.id}> ออกจาก Ticket แล้ว` });
            }
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'ticket_create') {
                const payload = buildTypeSelectMessage();
                payload.flags = 32768 | 64;
                return interaction.reply(payload);
            }
            if (interaction.customId === 'ticket_close') return closeTicket(interaction);
            if (interaction.customId === 'ticket_claim') return claimTicket(interaction);
            if (interaction.customId === 'ticket_transcript') return transcriptTicket(interaction);
            if (interaction.customId === 'ticket_my_list') return listMyTickets(interaction);
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'ticket_type_select') {
                const typeId = interaction.values[0];
                await interaction.deferUpdate();

                try {
                    const ticketChannel = await createTicketChannel(interaction, typeId);
                    await interaction.editReply({
                        flags: 32768 | 64,
                        components: [
                            {
                                type: 17,
                                accent_color: COLORS.success,
                                components: [
                                    { type: 10, content: `# ✅ สร้าง Ticket สำเร็จ!\n**ห้องของคุณ: <#${ticketChannel.id}>**` }
                                ]
                            }
                        ]
                    });
                } catch (err) {
                    console.error('Create ticket error:', err);
                    await interaction.editReply({
                        flags: 32768 | 64,
                        components: [
                            {
                                type: 17,
                                accent_color: COLORS.danger,
                                components: [
                                    { type: 10, content: `# ❌ ไม่สามารถสร้าง Ticket ได้\n${err.message}` }
                                ]
                            }
                        ]
                    });
                }
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ เกิดข้อผิดพลาด', ephemeral: true }).catch(() => { });
        }
    }
});

client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Ticket Bot online: ${c.user.tag}`);

    c.user.setPresence({
        activities: [{ name: '🎫 ระบบ Ticket 24 ชม.', type: ActivityType.Watching }],
        status: Status.Online,
    });

    try {
        const rest = new REST({ version: '10' }).setToken(TICKET_BOT_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            {
                body: [
                    new SlashCommandBuilder()
                        .setName('ticket-panel')
                        .setDescription('ส่งแผงเปิด Ticket')
                        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                        .toJSON(),
                ]
            }
        );
        console.log('✅ Slash commands synced');
    } catch (err) {
        console.error('❌ Sync commands failed:', err.message);
    }
});

const app = express();

app.get('/transcript/:id', (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(TRANSCRIPT_DIR, `${id}.html`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send(`
            <html><body style="font-family:sans-serif;background:#1e1f22;color:#dbdee1;text-align:center;padding:80px">
            <h1>❌ ไม่พบ Transcript</h1>
            <p>ลิงก์นี้อาจหมดอายุ หรือถูกลบไปแล้ว</p>
            </body></html>
        `);
    }
    res.sendFile(filePath);
});

app.get('/', (req, res) => {
    let data = { transcripts: [] };
    try { data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch { }

    const items = data.transcripts
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(t => `
            <a class="item" href="/transcript/${t.id}" target="_blank">
                <div class="item-title">📄 ${escapeHtml(t.channelName)}</div>
                <div class="item-meta">
                    <span>👤 ${escapeHtml(t.ownerTag)}</span>
                    <span>💬 ${t.messageCount} ข้อความ</span>
                    <span>🕐 ${new Date(t.createdAt).toLocaleString('th-TH')}</span>
                </div>
            </a>
        `).join('');

    res.send(`
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>Transcripts</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #1e1f22; color: #dbdee1; padding: 40px 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; background: linear-gradient(135deg, #6366f1, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #949ba4; margin-bottom: 24px; }
    .item { display: block; background: #2b2d31; padding: 16px 20px; border-radius: 10px; margin-bottom: 10px; text-decoration: none; color: inherit; transition: all 0.2s; border-left: 4px solid #6366f1; }
    .item:hover { background: #313338; transform: translateX(4px); }
    .item-title { font-weight: 600; color: #fff; margin-bottom: 6px; }
    .item-meta { font-size: 13px; color: #949ba4; display: flex; gap: 16px; flex-wrap: wrap; }
    .empty { text-align: center; padding: 60px; color: #6d6f78; }
</style>
</head>
<body>
<div class="container">
    <h1>📁 Ticket Transcripts</h1>
    <p class="subtitle">ทั้งหมด ${data.transcripts.length} รายการ</p>
    ${items || '<div class="empty">ยังไม่มี transcript</div>'}
</div>
</body>
</html>
    `);
});

app.listen(WEB_PORT, () => {
    console.log(`✅ Web server online: ${WEB_BASE_URL}`);
});

client.login(TICKET_BOT_TOKEN).catch(err => {
    console.error('❌ Ticket bot login failed:', err.message);
    process.exit(1);
});