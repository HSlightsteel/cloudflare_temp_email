import { Context } from "hono";
import { Jwt } from "hono/utils/jwt";
import { CONSTANTS } from "../constants";
import { HonoCustomType } from "../types";
import { getIntValue, getJsonSetting } from "../utils";
import { deleteAddressWithData, newAddress } from "../common";

export const tgUserNewAddress = async (
    c: Context<HonoCustomType>, userId: string, address: string
): Promise<{ address: string, jwt: string }> => {
    if (c.env.RATE_LIMITER) {
        const { success } = await c.env.RATE_LIMITER.limit(
            { key: `${CONSTANTS.TG_KV_PREFIX}:${userId}` }
        )
        if (!success) {
            throw Error("Rate limit exceeded")
        }
    }
    // @ts-ignore
    address = address || Math.random().toString(36).substring(2, 15);
    const [name, domain] = address.includes("@") ? address.split("@") : [address, null];
    const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
    if (jwtList.length >= getIntValue(c.env.TG_MAX_ADDRESS, 5)) {
        throw Error("The number of bound emails has reached the limit");
    }
    // check name block list
    const value = await getJsonSetting(c, CONSTANTS.ADDRESS_BLOCK_LIST_KEY);
    const blockList = (value || []) as string[];
    if (blockList.some((item) => name.includes(item))) {
        throw Error(`Name[${name}]is blocked`);
    }
    const res = await newAddress(c, {
        name: name || Math.random().toString(36).substring(2, 15),
        domain,
        enablePrefix: true
    });
    // for mail push to telegram
    await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, JSON.stringify([...jwtList, res.jwt]));
    await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${res.address}`, userId.toString());
    return res;
}

export const jwtListToAddressData = async (
    c: Context<HonoCustomType>, jwtList: string[]
): Promise<{
    addressList: string[], addressIdMap: Record<string, number>,
    invalidJwtList: string[]
}> => {
    const addressList = [] as string[];
    const addressIdMap = {} as Record<string, number>;
    const invalidJwtList = [] as string[];
    for (const jwt of jwtList) {
        try {
            const { address, address_id } = await Jwt.verify(jwt, c.env.JWT_SECRET, "HS256");
            addressList.push(address as string);
            addressIdMap[address as string] = address_id as number;
        } catch (e) {
            addressList.push("Invalid credentials");
            invalidJwtList.push(jwt);
            console.log(`Failed to obtain address list: ${(e as Error).message}`);
        }
    }
    return { addressList, addressIdMap, invalidJwtList };
}

export const bindTelegramAddress = async (
    c: Context<HonoCustomType>, userId: string, jwt: string
): Promise<string> => {
    const { address } = await Jwt.verify(jwt, c.env.JWT_SECRET, "HS256");
    if (!address) {
        throw Error("Invalid credentials");
    }
    const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
    const { addressIdMap } = await jwtListToAddressData(c, jwtList);
    if (address as string in addressIdMap) {
        return address as string;
    }
    if (jwtList.length >= getIntValue(c.env.TG_MAX_ADDRESS, 5)) {
        throw Error("The number of bound emails has reached the limit");
    }
    await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, JSON.stringify([...jwtList, jwt]));
    // for mail push to telegram
    await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${address}`, userId.toString());
    return address as string;
}

export const unbindTelegramAddress = async (
    c: Context<HonoCustomType>, userId: string, address: string
): Promise<boolean> => {
    const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
    const newJwtList = [];
    for (const jwt of jwtList) {
        try {
            const { address: kvAddress } = await Jwt.verify(jwt, c.env.JWT_SECRET, "HS256");
            if (kvAddress == address) {
                continue;
            }
        } catch (e) {
            console.log(`Unbinding failed: ${(e as Error).message}`);
        }
        newJwtList.push(jwt);
    }
    await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, JSON.stringify(newJwtList));
    await c.env.KV.delete(`${CONSTANTS.TG_KV_PREFIX}:${address}`);
    return true;
}

export const unbindTelegramByAddress = async (
    c: Context<HonoCustomType>, address: string
): Promise<boolean> => {
    if (!c.env.KV) return true;
    const userId = await c.env.KV.get<string>(`${CONSTANTS.TG_KV_PREFIX}:${address}`)
    if (userId) {
        return await unbindTelegramAddress(c, userId, address);
    }
    return true;
}


export const deleteTelegramAddress = async (
    c: Context<HonoCustomType>, userId: string, address: string
): Promise<boolean> => {
    const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
    const { addressIdMap } = await jwtListToAddressData(c, jwtList);
    if (!(address in addressIdMap)) {
        throw Error("This address does not belong to you");
    }
    await deleteAddressWithData(c, null, addressIdMap[address])
    return true;
}
