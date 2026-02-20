module.exports = function(io) {

  let messages = [];
  let users = {};

  function cleanOldMessages() {
    const now = Date.now();
    messages = messages.filter(msg => now - msg.createdAt < 24 * 60 * 60 * 1000);
  }

  io.on("connection", (socket) => {

    socket.on("join", (username) => {
      if (!username) return;

      users[socket.id] = username;

      cleanOldMessages();

      const lastMessages = messages.slice(-10);
      socket.emit("oldMessages", lastMessages);

      io.emit("message", {
        user: "AmbikaShelf",
        text: `${username} joined the chat`,
        time: new Date().toLocaleTimeString()
      });
    });

    socket.on("sendMessage", (data) => {
  const username = users[socket.id];
  if (!username || !data.text.trim()) return;

  cleanOldMessages();

  const messageData = {
    user: username,
    text: data.text,
    reply: data.reply || null,
    time: new Date().toLocaleTimeString(),
    createdAt: Date.now()
  };

  messages.push(messageData);
  if (messages.length > 10) messages.shift();

  io.emit("message", messageData);
});
    socket.on("clearChat", () => {
      messages = [];
      io.emit("chatCleared");
    });

    socket.on("disconnect", () => {
      const username = users[socket.id];
      if (username) {
        io.emit("message", {
          user: "System",
          text: `${username} left the chat`,
          time: new Date().toLocaleTimeString()
        });
        delete users[socket.id];
      }
    });

  });

};
