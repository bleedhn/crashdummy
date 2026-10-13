
const embeds = message.embeds
    .filter(embed => embed.data.type === 'rich')
    .slice(0, 10)
    .map(embed => embed.toJSON());

const messageContent = message.content || '';

if (!messageContent && embeds.length === 0) {
    console.log(`Skipping unsupported message: ${message.id}`);
    continue;
}

await destination.send({
    content: messageContent.slice(0, 2000) || undefined,
    embeds: embeds,
    allowedMentions: {
        parse: []
    }
});

console.log(`Successfully copied message: ${message.id}`);
