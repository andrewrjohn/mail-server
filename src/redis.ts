import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;

async function getClient() {
  if (client) return client;

  client = (await createClient({
    url: "rediss://default:AWvKAAIjcDFkZmQ2ZjNjMGVkZjY0NGMwOWE5ODdjZmQxYzhkODdlMHAxMA@handy-werewolf-27594.upstash.io:6379",
  })
    .on("error", (err) => console.error("Redis error", err))
    .connect()) as RedisClientType;

  return client;
}

export const Redis = {
  updateLastAccessed: async (user: string, clientStr: string) => {
    const client = await getClient();

    await client.hSet(`meta:${user}`, "last_client", clientStr);
    await client.hSet(`meta:${user}`, "timestamp", +new Date());
  },

  saveEmail: async (user: string, from: string, data: string) => {
    const client = await getClient();
    const key = `inbox:${user}:${+new Date()}`
    await client.hSet(key, 'from', from)
    await client.hSet(key, 'data', data)
  }
};
