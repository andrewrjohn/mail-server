import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";

const httpServer = createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  console.log(req.headers);

  res.setHeader("Auth-Status", "OK");
  res.setHeader("Auth-Server", "127.0.0.1");
  res.setHeader("Auth-Port", "3131");
  res.statusCode = 200;

  res.end();

  req.on("end", () => {
    res.end();
  });
});

httpServer.listen(3001, undefined, undefined, () => {
  console.log("HTTP server is running on port 3001");
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

const server = net.createServer((socket) => {
  socket.write("220 WeaklyTyped SMTP Server\r\n");

  let from = "";
  let to = "";
  let emailData = "";
  let isDataMode = false;

  socket.on("data", (data) => {
    const command = data.toString().trim();

    if (isDataMode) {
      const lines = command.split("\n");
      for (const line of lines) {
        if (line.trim() === ".") {
          console.log(`Message received from ${from} to ${to}`);
          isDataMode = false;
          fs.writeFileSync(
            path.join(emailsDir, `${+new Date()}.txt`),
            emailData
          );
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
          from = command
            .split(" ")[1]
            .trim()
            .toLowerCase()
            .replace("from:", "")
            .replace("<", "")
            .replace(">", "");

          socket.write(`250 OK\r\n`);
          break;
        case COMMANDS.RECIPIENT:
          to = command
            .split(" ")[1]
            .trim()
            .toLowerCase()
            .replace("to:", "")
            .replace("<", "")
            .replace(">", "");

          socket.write(`250 OK\r\n`);
          break;
        case COMMANDS.DATA:
          socket.write(`354 \r\n`);

          isDataMode = true;

          break;
        case COMMANDS.RESET:
          from = "";
          to = "";
          emailData = "";

          socket.write(`250 OK\r\n`);
          break;
        case COMMANDS.QUIT:
          from = "";
          to = "";
          emailData = "";

          socket.write(`221 OK\r\n`);
          socket.end();
          break;
        default:
      }
    }
  });
});

server.listen(3131, undefined, () => {
  console.log("SMTP server is running on port 3131");
});
