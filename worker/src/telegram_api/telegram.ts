
import { Context } from "hono";
import { Telegraf, Context as TgContext, Markup } from "telegraf";
import { callbackQuery } from "telegraf/filters";

import { CONSTANTS } from "../constants";
import { getDomains, getJsonObjectValue, getStringValue } from '../utils';
import { HonoCustomType, ParsedEmailContext } from "../types";
import { TelegramSettings } from "./settings";
import { bindTelegramAddress, deleteTelegramAddress, jwtListToAddressData, tgUserNewAddress, unbindTelegramAddress, unbindTelegramByAddress } from "./common";
import { commonParseMail } from "../common";
import { UserFromGetMe } from "telegraf/types";


const COMMANDS = [
    {
        command: "start",
        description: "Start"
    },
    {
        command: "new",
        description: "Create a new email. For custom email do /new <name>@<domain>, name can be [a-z0-9]"
    },
    {
        command: "address",
        description: "View list of emails"
    },
    {
        command: "bind",
        description: "To bind, /bind <Mail Credential>"
    },
    {
        command: "unbind",
        description: "To unbind, /unbind <email address>"
    },
    {
        command: "delete",
        description: "To delete, /delete <email address>"
    },
    {
        command: "mails",
        description: "To view email, do /mails <email address>, otherwise first address will be used"
    },
    {
        command: "cleaninvalidaddress",
        description: "Cleans up invalid address with /cleaninvalidaddress"
    },
]

export function newTelegramBot(c: Context<HonoCustomType>, token: string): Telegraf {
    const bot = new Telegraf(token);
    const botInfo = getJsonObjectValue<UserFromGetMe>(c.env.TG_BOT_INFO);
    if (botInfo) {
        bot.botInfo = botInfo;
    }

    bot.use(async (ctx, next) => {
        // check if in private chat
        if (ctx.chat?.type !== "private") {
            return;
        }

        const userId = ctx?.message?.from?.id || ctx.callbackQuery?.message?.chat?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }

        const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
        if (settings?.enableAllowList && settings?.enableAllowList
            && !settings.allowList.includes(userId.toString())
        ) {
            return await ctx.reply("You dont have permission to use this bot");
        }
        try {
            await next();
        } catch (error) {
            console.error(`Error: ${error}`);
            return await ctx.reply(`Error: ${error}`);
        }
    })

    bot.command("start", async (ctx: TgContext) => {
        const prefix = getStringValue(c.env.PREFIX)
        const domains = getDomains(c);
        return await ctx.reply(
            "Welcome, you can use the web ui \n\n"
            + (prefix ? `Prefix is currently enabled: ${prefix}\n` : '')
            + `Available domains: ${JSON.stringify(domains)}\n`
            + "Please use the following cmd:\n"
            + COMMANDS.map(c => `/${c.command}: ${c.description}`).join("\n")
        );
    });

    bot.command("new", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/new".length).trim();
            const res = await tgUserNewAddress(c, userId.toString(), address);
            return await ctx.reply(`Address created successfully:\n`
                + `address: ${res.address}\n`
                + `certificate: ${res.jwt}\n`
            );
        } catch (e) {
            return await ctx.reply(`Failed to create address: ${(e as Error).message}`);
        }
    });

    bot.command("bind", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        try {
            // @ts-ignore
            const jwt = ctx?.message?.text.slice("/bind".length).trim();
            if (!jwt) {
                return await ctx.reply("Please enter credentials");
            }
            const address = await bindTelegramAddress(c, userId.toString(), jwt);
            return await ctx.reply(`Binding successful:\n`
                + `Address: ${address}`
            );
        }
        catch (e) {
            return await ctx.reply(`Binding failed: ${(e as Error).message}`);
        }
    });

    bot.command("unbind", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/unbind".length).trim();
            if (!address) {
                return await ctx.reply("Please enter address");
            }
            await unbindTelegramAddress(c, userId.toString(), address);
            return await ctx.reply(`Unbinding successful:\nAddress: ${address}`
            );
        }
        catch (e) {
            return await ctx.reply(`Unbinding failed: ${(e as Error).message}`);
        }
    })

    bot.command("delete", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/unbind".length).trim();
            if (!address) {
                return await ctx.reply("Please enter address");
            }
            await deleteTelegramAddress(c, userId.toString(), address);
            return await ctx.reply(`Deletion successful: ${address}`);
        } catch (e) {
            return await ctx.reply(`Deletion failed: ${(e as Error).message}`);
        }
    });

    bot.command("address", async (ctx) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        try {
            const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
            const { addressList } = await jwtListToAddressData(c, jwtList);
            return await ctx.reply(`List of address:\n\n`
                + addressList.map(a => `Address: ${a}`).join("\n")
            );
        } catch (e) {
            return await ctx.reply(`Failed to obtain address list: ${(e as Error).message}`);
        }
    });

    bot.command("cleaninvalidadress", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        try {
            const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
            const { invalidJwtList } = await jwtListToAddressData(c, jwtList);
            const newJwtList = jwtList.filter(jwt => !invalidJwtList.includes(jwt));
            await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, JSON.stringify(newJwtList));
            const { addressList } = await jwtListToAddressData(c, newJwtList);
            return await ctx.reply(`Clearing invalid address successfully:\n\n`
                + `Current address list:\n\n`
                + addressList.map(a => `Address: ${a}`).join("\n")
            );
        } catch (e) {
            return await ctx.reply(`Failed to clean up invalid address: ${(e as Error).message}`);
        }
    });

    const queryMail = async (ctx: TgContext, queryAddress: string, mailIndex: number, edit: boolean) => {
        const userId = ctx?.message?.from?.id || ctx.callbackQuery?.message?.chat?.id;
        if (!userId) {
            return await ctx.reply("Unable to obtain user information");
        }
        const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
        const { addressList, addressIdMap } = await jwtListToAddressData(c, jwtList);
        if (!queryAddress && addressList.length > 0) {
            queryAddress = addressList[0];
        }
        if (!(queryAddress in addressIdMap)) {
            return await ctx.reply(`This address is not bound ${queryAddress}`);
        }
        const address_id = addressIdMap[queryAddress];
        const db_address_id = await c.env.DB.prepare(
            `SELECT id FROM address where id = ? `
        ).bind(address_id).first("id");
        if (!db_address_id) {
            return await ctx.reply("Invalid address");
        }
        const { raw, id: mailId, created_at } = await c.env.DB.prepare(
            `SELECT * FROM raw_mails where address = ? `
            + ` order by id desc limit 1 offset ?`
        ).bind(
            queryAddress, mailIndex
        ).first<{ raw: string, id: string, created_at: string }>() || {};
        const { mail } = raw ? await parseMail({ rawEmail: raw }, queryAddress, created_at) : { mail: "There is no email anymore" };
        const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
        const miniAppButtons = []
        if (settings?.miniAppUrl && settings?.miniAppUrl?.length > 0 && mailId) {
            const url = new URL(settings.miniAppUrl);
            url.pathname = "/telegram_mail"
            url.searchParams.set("mail_id", mailId);
            miniAppButtons.push(Markup.button.webApp("Check mail", url.toString()));
        }
        if (edit) {
            return await ctx.editMessageText(mail || "No mail",
                {
                    ...Markup.inlineKeyboard([
                        Markup.button.callback("Previous", `mail_${queryAddress}_${mailIndex - 1}`, mailIndex <= 0),
                        ...miniAppButtons,
                        Markup.button.callback("Next", `mail_${queryAddress}_${mailIndex + 1}`, !raw),
                    ])
                },
            );
        }
        return await ctx.reply(mail || "No mail",
            {
                ...Markup.inlineKeyboard([
                    Markup.button.callback("Previous", `mail_${queryAddress}_${mailIndex - 1}`, mailIndex <= 0),
                    ...miniAppButtons,
                    Markup.button.callback("Next", `mail_${queryAddress}_${mailIndex + 1}`, !raw),
                ])
            },
        );
    }

    bot.command("mails", async ctx => {
        try {
            const queryAddress = ctx?.message?.text.slice("/mails".length).trim();
            return await queryMail(ctx, queryAddress, 0, false);
        } catch (e) {
            return await ctx.reply(`Failed to get email: ${(e as Error).message}`);
        }
    });

    bot.on(callbackQuery("data"), async ctx => {
        // Use ctx.callbackQuery.data
        try {
            const data = ctx.callbackQuery.data;
            if (data && data.startsWith("mail_") && data.split("_").length === 3) {
                const [_, queryAddress, mailIndex] = data.split("_");
                await queryMail(ctx, queryAddress, parseInt(mailIndex), true);
            }
        }
        catch (e) {
            console.log(`Failed to get email: ${(e as Error).message}`, e);
            return await ctx.answerCbQuery(`Failed to get email: ${(e as Error).message}`);
        }
        await ctx.answerCbQuery();
    });

    return bot;
}


export async function initTelegramBotCommands(bot: Telegraf) {
    await bot.telegram.setMyCommands(COMMANDS);
}

const parseMail = async (
    parsedEmailContext: ParsedEmailContext,
    address: string, created_at: string | undefined | null
) => {
    if (!parsedEmailContext.rawEmail) {
        return {};
    }
    try {
        const parsedEmail = await commonParseMail(parsedEmailContext);
        let parsedText = parsedEmail?.text || "";
        if (parsedText.length && parsedText.length > 1000) {
            parsedText = parsedEmail?.text.substring(0, 1000) + "\n\n...\nIf message is too long use web ui to check";
        }
        return {
            isHtml: false,
            mail: `From: ${parsedEmail?.sender || "No sender"}\n`
                + `To: ${address}\n`
                + (created_at ? `Date: ${created_at}\n` : "")
                + `Subject: ${parsedEmail?.subject}\n`
                + `Content:\n${parsedText || "Parsing failed，use web ui to view"}`
        };
    } catch (e) {
        return {
            isHtml: false,
            mail: `Failed to parse email: ${(e as Error).message}`
        };
    }
}


export async function sendMailToTelegram(
    c: Context<HonoCustomType>, address: string,
    parsedEmailContext: ParsedEmailContext,
    message_id: string | null
) {
    if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.KV) {
        return;
    }
    const userId = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:${address}`);
    const { mail } = await parseMail(parsedEmailContext, address, new Date().toUTCString());
    if (!mail) {
        return;
    }
    const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
    const globalPush = settings?.enableGlobalMailPush && settings?.globalMailPushList;
    if (!userId && !globalPush) {
        return;
    }
    const mailId = await c.env.DB.prepare(
        `SELECT id FROM raw_mails where address = ? and message_id = ?`
    ).bind(address, message_id).first<string>("id");
    const bot = newTelegramBot(c, c.env.TELEGRAM_BOT_TOKEN);
    const miniAppButtons = []
    if (settings?.miniAppUrl && settings?.miniAppUrl?.length > 0 && mailId) {
        const url = new URL(settings.miniAppUrl);
        url.pathname = "/telegram_mail"
        url.searchParams.set("mail_id", mailId);
        miniAppButtons.push(Markup.button.webApp("Check mail", url.toString()));
    }
    if (globalPush) {
        for (const pushId of settings.globalMailPushList) {
            await bot.telegram.sendMessage(pushId, mail, {
                ...Markup.inlineKeyboard([
                    ...miniAppButtons,
                ])
            });
        }
    }
    if (!userId) {
        return;
    }
    await bot.telegram.sendMessage(userId, mail, {
        ...Markup.inlineKeyboard([
            ...miniAppButtons,
        ])
    });
}
