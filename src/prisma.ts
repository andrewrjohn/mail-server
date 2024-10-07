import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

const cleanUser = (user: string) => user.replace("@weaklytyped.com", "").trim();

// export const Db = {
//     saveEmail: async (username: string, from: string, content: string) => {
//         username = cleanUser(username)

//         let inbox = await prisma.inbox.findFirst({where: {user: username}})
//         if (!inbox) {
//             inbox = await prisma.inbox.create({data: {user: username}})

//         }
//         await
//     }
// }
