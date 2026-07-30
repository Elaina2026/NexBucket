import { EmbedBuilder as DiscordEmbedBuilder } from 'discord.js';
let botClient = null;
export function setClient(client) {
  botClient = client;
}
export class EmbedBuilder extends DiscordEmbedBuilder {
  constructor(data) {
    super(data);
    if (botClient && botClient.user) {
      this.setFooter({ 
        text: botClient.user.username, 
        iconURL: botClient.user.displayAvatarURL() 
      });
    } 
  }
  setFooter(options) {
    if (botClient && botClient.user && options) {
      if (!options.iconURL) {
        options.iconURL = botClient.user.displayAvatarURL();
      }
    }
    return super.setFooter(options);
  }
}