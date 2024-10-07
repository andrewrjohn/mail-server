import net from "net";
import { Redis } from "./redis";
import { prisma } from "./prisma";
import { Inbox } from "@prisma/client";

const domain = "@weaklytyped.com";

export const credentials = {
  andrew: "Uz4R4eJ3C6XP4nG6ZbFn4WNJT19lrZx",
};

const CRLF = "\r\n";

export const imapServer = net.createServer((socket) => {
  console.log("IMAP connection");

  let currentInbox: Inbox | null = null;
  let expectingLiteral = false;
  let literalLength = 0;
  let literals: string[] = [];
  let currentTag = "";
  let currentCommand = "";
  let isIdling = false;

  socket.on("end", () => {
    console.log("IMAP socket ended");
  });
  socket.on("close", (error) => {
    console.log(`IMAP socket closed. Error: ${error}`);
  });

  socket.on("error", (error) => {
    console.error("IMAP socket error:", error);
  });

  const sendResponse = (tag: string, status: string, message: string) => {
    // console.log(`Sending response ${tag} ${status} ${message}`);
    socket.write(`${tag} ${status} ${message}${CRLF}`);
  };

  sendResponse(
    "*",
    "OK",
    `[CAPABILITY AUTH=PLAIN LOGIN IDLE MOVE STARTTLS UIDPLUS UNSELECT ID SPECIAL-USE LITERAL+ NAMESPACE IMAP4rev2] WeaklyTyped IMAP4 server`
  );

  socket.on("data", async (data) => {
    const lines = data.toString().split(CRLF);

    const handleCommand = async (
      tag: string,
      command: string,
      args: string[]
    ) => {
      currentTag = "";
      currentCommand = "";
      literals = [];
      expectingLiteral = false;
      literalLength = 0;
      isIdling = false;

      switch (command.toUpperCase()) {
        case "CAPABILITY":
          socket.write(
            `* CAPABILITY AUTH=PLAIN LOGIN IDLE MOVE STARTTLS UIDPLUS UNSELECT ID SPECIAL-USE LITERAL+ NAMESPACE IMAP4rev2${CRLF}`
          );
          sendResponse(tag, "OK", "CAPABILITY completed");
          break;

        case "LOGIN":
          if (args.length !== 2) {
            return sendResponse(tag, "BAD", "Invalid credentials");
          }

          let [user, password] = args;
          user = user.replace(domain, "");

          const inbox = await prisma.inbox.findFirst({
            where: { user, password },
          });

          if (inbox) {
            console.log("log in success", user);

            currentInbox = inbox;

            return sendResponse(tag, "OK", `${command} completed`);
          } else {
            sendResponse(tag, "BAD", "Invalid credentials");
          }
          break;

        case "LOGOUT":
          console.log("logging out....");
          currentInbox = null;

          sendResponse("*", "BYE", "Logging out");

          if (!socket.closed) {
            sendResponse(tag, "OK", "LOGOUT completed");
          }
          break;
        case "NAMESPACE":
          sendResponse("*", "NAMESPACE", `(("" "/")) NIL NIL`);
          sendResponse(tag, "OK", "NAMESPACE completed");
          break;
        case "ID":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          const arr = args.map((item) =>
            item.replace("(", "").replace(")", "").replace(/\"/gim, "")
          );

          const kv: Record<string, string> = {};
          for (let i = 0; i < arr.length; i++) {
            if (i === 0) {
              const key = arr[i];
              const value = arr[i + 1];

              if (key && value) {
                kv[key] = value;
              }
            }
            if (i % 2 === 0) {
              const key = arr[i];
              const value = arr[i + 1];

              if (key && value) {
                kv[key] = value;
              }
            }
          }

          // Spec: https://www.rfc-editor.org/rfc/rfc2971.html
          await Redis.updateLastAccessed(
            currentInbox.user,
            `${Object.values(kv).join(" ")}`
          );

          sendResponse("*", "ID", `NIL`);
          sendResponse(tag, "OK", "ID completed");
          break;
        case "SELECT":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          const count = await prisma.email.count({
            where: { inboxId: currentInbox.id },
          });

          sendResponse("*", count.toString(), "EXISTS");
          sendResponse(
            "*",
            "FLAGS",
            "(Seen Answered Flagged Deleted Draft Recent)"
          );
          sendResponse("*", "LIST", `() "/" INBOX`);
          sendResponse(`*`, "OK", `[UIDVALIDITY ${+new Date()}] UIDs valid`);
          sendResponse(
            `*`,
            "OK",
            `[UIDNEXT ${currentInbox.uidNext}] Predicted next UID`
          );
          sendResponse("*", "OK", `[PERMANENTFLAGS (\Recent)] Limited`);
          sendResponse(tag, "OK", `[READ-ONLY] SELECT completed`);

          break;
        case "LIST":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          sendResponse(tag, "OK", "LIST completed");
          break;
        case "CREATE":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          sendResponse(tag, "OK", "CREATE completed");
          break;
        case "LSUB":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          sendResponse(tag, "OK", "LIST completed");
          break;
        case "NOOP":
          sendResponse(tag, "OK", "NOOP completed");
          break;
        case "IDLE":
          isIdling = true;
          socket.write("+ idling");
          break;
      }
    };

    const handleLiteral = (line: string) => {
      const sizeMatches = line.match(/.*\{(.*)\}.*/im);
      if (!sizeMatches) return sendResponse("*", "BAD", "");

      const size = sizeMatches[1];
      expectingLiteral = true;
      literalLength = parseInt(size);

      socket.write(`+ Ready for literal data${CRLF}`);
    };

    for (const line of lines) {
      console.log(`${line}`);
      if (!line) continue;

      if (!currentTag) {
        const [tag] = line.split(" ");
        currentTag = tag;
      }

      if (!currentCommand) {
        const [_, command] = line.split(" ");
        currentCommand = command;
      }

      if (isIdling) {
        if (line.toUpperCase().trim() === "DONE") {
          isIdling = false;
          sendResponse(currentTag, "OK", "IDLE terminated");
        }
      } else {
        const hasLiteral = line.includes("{");

        if (expectingLiteral) {
          const literal = line.slice(0, literalLength);
          if (literal) {
            literals.push(literal);
          }

          if (hasLiteral) {
            handleLiteral(line);
          } else {
            await handleCommand(currentTag, currentCommand, literals);
          }
        } else if (hasLiteral) {
          handleLiteral(line);
        } else {
          const [tag, command, ...args] = line.split(" ");

          await handleCommand(tag, command, args);
        }
      }
    }
  });
});
