module.exports = function(io) {

let messages = [];
let users = {};
let typingUsers = {};

function cleanOldMessages() {
  const now = Date.now();
  messages = messages.filter(m => now - m.createdAt < 24 * 60 * 60 * 1000);
}

module.exports = function(io) {

  io.on("connection", (socket) => {

    socket.on("join", (username) => {
      if (!username) return;

      users[socket.id] = username;
      cleanOldMessages();

      socket.emit("oldMessages", messages.slice(-10));

      io.emit("message", {
        id: Date.now(),
        user: "AmbikaShelf",
        text: `${username} joined the chat`,
        time: new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"}),
        createdAt: Date.now()
      });
    });

    socket.on("typing", () => {
      typingUsers[socket.id] = users[socket.id];
      socket.broadcast.emit("typing", users[socket.id]);
    });

    socket.on("stopTyping", () => {
      delete typingUsers[socket.id];
      socket.broadcast.emit("stopTyping");
    });

    socket.on("sendMessage", (data) => {
      const username = users[socket.id];
      if (!username) return;

      cleanOldMessages();

      const messageData = {
        id: Date.now(),
        user: username,
        text: data.text || "",
        image: data.image || null,
        reply: data.reply || null,
        reactions: {},
        time: new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"}),
        createdAt: Date.now()
      };

      messages.push(messageData);

      if (messages.length > 50) messages.shift();

      io.emit("message", messageData);
    });

    socket.on("react", ({id, emoji}) => {
      const msg = messages.find(m => m.id === id);
      if (!msg) return;

      msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;
      io.emit("reactionUpdate", {id, reactions: msg.reactions});
    });

    socket.on("disconnect", () => {
      const username = users[socket.id];
      if (username) {
        io.emit("message", {
          id: Date.now(),
          user: "AmbikaShelf",
          text: `${username} left the chat`,
          time: new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"}),
          createdAt: Date.now()
        });
      }
      delete users[socket.id];
    });

  });

};
