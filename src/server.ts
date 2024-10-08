import { createServer } from "http";
import { prisma } from "./prisma";
import net from "net";
import fs from "fs";
import path from "path";
import { credentials, imapServer } from "./imap.server";
import { Redis } from "./redis";

const httpServer = createServer(async (req, res) => {
  req.on("end", () => {
    res.end();
  });

  const protocol = req.headers["auth-protocol"];
  console.log(`${req.method} ${req.url} - ${protocol}`);

  const error = (message: string) => {
    res.setHeader("Auth-Status", message);
    res.statusCode = 200;
    res.end();
  };

  if (typeof protocol !== "string") {
    return error("Invalid protocol");
  }

  switch (protocol.toLowerCase()) {
    case "smtp":
      res.setHeader("Auth-Status", "OK");
      res.setHeader("Auth-Server", "127.0.0.1");
      res.setHeader("Auth-Port", "3131");
      res.statusCode = 200;

      res.end();
      break;
    case "imap":
      const user = req.headers["auth-user"];
      const pass = req.headers["auth-pass"];

      const username = user?.toString().replace("@weaklytyped.com", "");
      const inbox = await prisma.inbox.findFirst({
        where: { user: username, password: pass?.toString().trim() },
      });

      if (!inbox) {
        return error("Invalid credentials");
      }

      res.setHeader("Auth-Status", "OK");
      res.setHeader("Auth-Server", "127.0.0.1");
      res.setHeader("Auth-Port", "3002");
      res.statusCode = 200;
      res.end();
      break;
    default:
      return error(`Unsupported protocol: ${protocol}`);
  }
});

const DOMAIN = "smtp.weaklytyped.com";

const COMMANDS = {
  EHLO: "EHLO",
  HELO: "HELO",
  QUIT: "QUIT",
  MAIL: "MAIL",
  XCLIENT: "XCLIENT",
  RECIPIENT: "RCPT",
  DATA: "DATA",
  RESET: "RSET",
};

const emailsDir = path.join(__dirname, "emails");
if (!fs.existsSync(emailsDir)) {
  fs.mkdirSync(emailsDir);
}

const parseAddress = (str: string) => {
  const match = str.match(/<(.+?)>/im);
  if (!match) {
    return str;
  }

  return match[1].trim();
};

const smtpServer = net.createServer((socket) => {
  socket.write("220 WeaklyTyped SMTP Server\r\n");

  let from = "";
  let to = "";
  let emailData = "";
  let isDataMode = false;

  const resetSession = () => {
    from = "";
    to = "";
    emailData = "";
    isDataMode = false;
  };

  socket.on("data", async (data) => {
    const command = data.toString().trim();

    if (isDataMode) {
      const lines = command.split("\n");
      for (const line of lines) {
        if (line.trim() === ".") {
          const user = to.replace("@weaklytyped.com", "").trim();
          const inbox = await prisma.inbox.findFirst({ where: { user } });
          if (inbox) {
            const numMessages = await prisma.email.count({
              where: { inboxId: inbox.id },
            });

            await prisma.email.create({
              data: {
                inboxId: inbox.id,
                from: from.trim(),
                content: emailData,
                uid: inbox.uidNext,
                sequenceNumber: numMessages + 1,
                sizeBytes: Buffer.from(emailData).byteLength,
              },
            });

            await prisma.inbox.update({
              where: { user },
              data: { uidNext: { increment: 1 } },
            });
          }

          console.log(`Message received from ${from} to ${to}`);
          // await Redis.saveEmail(
          //   to.replace("@weaklytyped.com", "").trim(),
          //   from.trim(),
          //   emailData
          // );
          isDataMode = false;
          // fs.writeFileSync(
          //   path.join(emailsDir, `${+new Date()}.txt`),
          //   emailData
          // );
          socket.write(`250 OK\r\n`);
          break;
        }

        emailData += command + "\n";
      }
    } else {
      // console.log("Received command:", command);
      const commandName = command.split(" ")[0];

      switch (commandName.trim()) {
        case COMMANDS.EHLO:
        case COMMANDS.HELO:
          socket.write(`250-${DOMAIN}\r\n`);
          socket.write(`250 \r\n`);
          break;
        case COMMANDS.XCLIENT:
          socket.write(`250 OK\r\n`);
          break;
        case COMMANDS.MAIL:
          resetSession();

          from = parseAddress(command);

          socket.write(`250 OK\r\n`);
          break;
        case COMMANDS.RECIPIENT:
          if (!from) {
            socket.write(`503 \r\n`);
            break;
          }

          to = parseAddress(command);

          if (!to.toLowerCase().endsWith(`@weaklytyped.com`)) {
            socket.write(`550 \r\n`);
          } else {
            socket.write(`250 OK\r\n`);
          }
          break;
        case COMMANDS.DATA:
          if (!from || !to) {
            socket.write(`503 \r\n`);
            break;
          }

          socket.write(`354 \r\n`);

          isDataMode = true;

          break;
        case COMMANDS.RESET:
          resetSession();

          socket.write(`250 OK\r\n`);
          break;
        case COMMANDS.QUIT:
          resetSession();

          socket.write(`221 OK\r\n`);
          socket.end();
          break;
        default:
      }
    }
  });
});

smtpServer.listen(3131, undefined, () => {
  console.log("SMTP server is running on port 3131");
});

httpServer.listen(3001, undefined, undefined, () => {
  console.log("HTTP server is running on port 3001");
});

imapServer.listen(3002, undefined, () => {
  console.log("IMAP server is running on port 3002");
});
