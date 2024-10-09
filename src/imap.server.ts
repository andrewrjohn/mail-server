import net from "net";
import { prisma } from "./prisma";
import { Inbox, Prisma } from "@prisma/client";

const domain = "@weaklytyped.com";

export const credentials = {
  andrew: "Uz4R4eJ3C6XP4nG6ZbFn4WNJT19lrZx",
};

const CRLF = "\r\n";

export const imapServer = net.createServer((socket) => {
  console.log("IMAP connection");

  let currentInbox: Inbox | null = null;
  let currentMailbox: "INBOX" | "DRAFTS" | null = null;
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
          currentInbox = null;
          currentMailbox = null;

          sendResponse("*", "BYE", "Logging out");

          // sendResponse(tag, "OK", "LOGOUT completed");
          // socket.end();
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

          // Spec for possible fields: https://www.rfc-editor.org/rfc/rfc2971.html
          // TODO: Save to DB

          sendResponse("*", "ID", `NIL`);
          sendResponse(tag, "OK", "ID completed");
          break;
        case "SELECT":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }
          const [selectMailbox] = args;

          let count = 0;
          const normalizedMailbox = selectMailbox
            .replace('"', "")
            .replace('"', "")
            .toUpperCase();

          if (normalizedMailbox !== currentMailbox && currentMailbox) {
            sendResponse("*", "OK", "[CLOSED]");
          }

          currentMailbox = normalizedMailbox as typeof currentMailbox;

          if (currentMailbox === "DRAFTS") {
            count = await prisma.email.count({
              where: { inboxId: currentInbox.id, draft: true },
            });
          } else if ((currentMailbox = "INBOX")) {
            count = await prisma.email.count({
              where: { inboxId: currentInbox.id },
            });
          }

          sendResponse("*", count.toString(), "EXISTS");
          sendResponse(`*`, "OK", `[UIDVALIDITY ${+new Date()}] UIDs valid`);
          sendResponse(
            `*`,
            "OK",
            `[UIDNEXT ${currentInbox.uidNext}] Predicted next UID`
          );
          sendResponse(
            "*",
            "FLAGS",
            `(\Seen \Answered \Flagged \Deleted \Draft)`
          );
          sendResponse("*", "OK", `[PERMANENTFLAGS ()] Limited`);
          sendResponse("*", "LIST", `() "/" ${selectMailbox}`);
          sendResponse(tag, "OK", `[READ-WRITE] SELECT completed`);

          break;
        case "LIST":
          // TODO
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          // sendResponse("*", "LIST")

          sendResponse(tag, "OK", "LIST completed");
          break;
        case "STATUS":
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          const [mailbox, ...dataItems] = args.map((a) =>
            a.replace(")", "").replace("(", "")
          );

          const response: string[] = [];

          for (const item of dataItems) {
            switch (item.toUpperCase()) {
              case "MESSAGES":
                const count = await prisma.email.count({
                  where: { inboxId: currentInbox.id },
                });
                response.push(`MESSAGES ${count}`);
                break;
              case "UIDNEXT":
                response.push(`UIDNEXT ${currentInbox.uidNext}`);
                break;
              case "UIDVALIDITY":
                response.push(`UIDVALIDITY ${+new Date()}`);
                break;
              case "UNSEEN":
                const unseenCount = await prisma.email.count({
                  where: { inboxId: currentInbox.id, seen: false },
                });

                response.push(`UNSEEN ${unseenCount}`);
                break;
              case "DELETED":
                const deletedCount = await prisma.email.count({
                  where: { inboxId: currentInbox.id, deleted: true },
                });

                response.push(`DELETED ${deletedCount}`);
                break;
              case "SIZE":
                const {
                  _sum: { sizeBytes },
                } = await prisma.email.aggregate({
                  _sum: { sizeBytes: true },
                  where: { inboxId: currentInbox.id },
                });

                response.push(`SIZE ${sizeBytes ?? 0}`);
                break;
              case "RECENT":
                response.push(`RECENT ${0}`);
                break;
              default:
                break;
            }
          }

          const statusResStr = `${mailbox} (${response.join(" ")})`;
          console.log(statusResStr);
          sendResponse("*", `STATUS`, statusResStr);

          sendResponse(tag, "OK", "STATUS completed");
          break;
        case "CREATE":
          // TODO
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          sendResponse(tag, "OK", "CREATE completed");
          break;
        case "LSUB":
          // TODO
          if (!currentInbox) {
            return sendResponse(tag, "BAD", "Not logged in");
          }

          sendResponse(tag, "OK", "LIST completed");
          break;
        case "NOOP":
          sendResponse(tag, "OK", "NOOP completed");
          break;
        case "SUBSCRIBE":
          // TODO
          sendResponse(tag, "OK", "SUBSCRIBE completed");
          break;
        case "IDLE":
          isIdling = true;
          // await new Promise((res) => setTimeout(res, 3000));
          // socket.write(`+ idling${CRLF}`);
          // socket.write(
          //   "* 2 FETCH (FLAGS (Seen) BODY[HEADER.FIELDS (DATE FROM)] {57}"
          // );

          // socket.write("Date: Mon, 7 Feb 2024 21:52:25 -0800");
          // socket.write("From: Alice <alice@example.com>");
          // sendResponse("*", "FETCH", ())
          const messageCount = await prisma.email.count({
            where: { inboxId: currentInbox?.id },
          });

          // socket.write(`* 12 FETCH (FLAGS (\Seen) INTERNALDATE
          // "17-Jul-1996 02:44:25 -0700" RFC822.SIZE ${message.sizeBytes} UID ${message.uid} ENVELOPE (
          // "Wed, 17 Jul 1996 02:23:25 -0700 (PDT)"
          // "IMAP4rev2 WG mtg summary and minutes"
          // (("Terry Gray" NIL "gray" "cac.washington.edu"))
          // (("Terry Gray" NIL "gray" "cac.washington.edu"))
          // (("Terry Gray" NIL "gray" "cac.washington.edu"))
          // ((NIL NIL "imap" "cac.washington.edu"))
          // ((NIL NIL "minutes" "CNRI.Reston.VA.US")
          // ("John Klensin" NIL "KLENSIN" "MIT.EDU")) NIL NIL
          // "<B27397-0100000@cac.washington.ed>")
          // BODY ("TEXT" "PLAIN" ("CHARSET" "US-ASCII") NIL NIL "7BIT"
          // 3028 92))`);
          socket.write(`+ idling`);
          sendResponse("*", messageCount.toString(), "EXISTS");
          break;
        case "UID":
          const [subcommand] = args;
          if (subcommand.toUpperCase() === "EXPUNGE") {
            sendResponse(tag, "OK", "UID EXPUNGE completed");
          } else if (subcommand.toUpperCase() === "SEARCH") {
            sendResponse(tag, "OK", "UID SEARCH completed");
          } else {
            let [_, uidSet, ...subArgs] = args;
            const [startUid, endUid] = uidSet.split(":");

            let query: Prisma.EmailFindManyArgs = {
              where: { AND: [{ uid: { gte: parseInt(startUid) } }] },
            };

            if (endUid && endUid !== "*") {
              if (!query.where) {
                query.where = {};
              }

              const existingAnd = query.where.AND;

              query.where.AND = [
                ...(Array.isArray(existingAnd) ? existingAnd ?? [] : []),
                { uid: { lte: parseInt(endUid) } },
              ];
            }

            const messages = await prisma.email.findMany({
              ...query,
              orderBy: { uid: "asc" },
            });

            subArgs = subArgs.map((a) => a.replace("(", "").replace(")", ""));

            for (const message of messages) {
              const response: string[] = [];
              let requiresHeader = false;
              for (const arg of subArgs) {
                switch (arg.toUpperCase()) {
                  case "FLAGS":
                    const flags: string[] = [];
                    message.seen && flags.push(`\\Seen`);
                    message.deleted && flags.push(`\\Deleted`);
                    message.flagged && flags.push(`\\Flagged`);
                    message.draft && flags.push(`\\Draft`);
                    message.answered && flags.push(`\\Answered`);

                    response.push(`FLAGS (${flags.join(" ")})`);
                    break;
                  case "RFC822.SIZE":
                    response.push(`RFC822.SIZE ${message.sizeBytes}`);
                    break;
                  case "RFC822.HEADER":
                    requiresHeader = true;
                    //   // const header = parseHeader(message.content);
                    const header = `To: andrew@weaklytyped.com\nFrom: Andrew Johnson ${message.uid} <test${message.uid}@test.com>\nSubject: Test foo ${message.uid}\nDate: Tue, 08 Oct 2024 10:07:25 -0500`;

                    //   // console.log(header);
                    const size = Buffer.from(header).byteLength;
                    //   // console.log(header);
                    response.push(`RFC822.HEADER {${size}}`);
                    break;
                  case "INTERNALDATE":
                    response.push(
                      `INTERNALDATE Tue, 08 Oct 2024 10:07:25 -0500`
                    );
                    break;
                  default:
                    break;
                }
              }

              let responseStr = `* ${message.sequenceNumber.toString()} ${subcommand.toUpperCase()} (${response.join(
                ` `
              )} UID ${message.uid})${CRLF}`;
              socket.write(responseStr);

              if (requiresHeader) {
                const header = `To: andrew@weaklytyped.com\nFrom: Andrew Johnson ${message.uid} <test${message.uid}@test.com>\nSubject: Test foo ${message.uid}\nDate: Tue, 08 Oct 2024 10:07:25 -0500`;

                // console.log(header);
                // const size = Buffer.from(header).byteLength;
                // console.log(header);
                // response.push(`RFC822.HEADER {${size}} ${header}`);
                socket.write(header);
              }

              console.log("writing uid fetch", message.uid, responseStr);
            }

            console.log("finishing UID fetch");
            await new Promise((res) => setTimeout(res, 3000));
            sendResponse(tag, "OK", "UID FETCH completed");
            console.log("finished!!! UID fetch");
          }
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
          console.log("IDLING stopping");
          sendResponse(currentTag, "OK", "IDLE terminated");
        }

        if (currentInbox) {
          const emails = await prisma.email.findMany({
            where: { inboxId: currentInbox.id },
          });

          // for (const email of emails) {

          // }
          //   console.log("sending fetch");
          //   socket.write(
          //     "* 2 FETCH (FLAGS (Seen) BODY[HEADER.FIELDS (DATE FROM)] {57}"
          //   );
          //   socket.write("Date: Mon, 7 Feb 2024 21:52:25 -0800");
          //   socket.write("From: Alice <alice@example.com>");
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
