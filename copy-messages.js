
const embeds = message.embeds
    .filter(embed => {
        return [
            'rich',
            'auto_moderation_message'
        ].includes(embed.data.type || 'rich');
    })
    .slice(0, 10)
    .map(embed => embed.toJSON());

const messageContent = content.slice(0, 2000);

if (!messageContent.trim() && embeds.length === 0) {
    console.log(`Skipping unsupported message: ${message.id}`);
    continue;
}

await webhook.send({
    username: (
        author?.displayName ||
        author?.username ||
        'Unknown User'
    ).slice(0, 80),

    avatarURL: author?.displayAvatarURL() || undefined,

    content: messageContent || undefined,

    embeds: embeds,

    allowedMentions: {
        parse: []
    }
});
