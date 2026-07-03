export default function registerSocketHandlers(io) {
  const roomUsers = {}; // roomId -> count of non-admin users
  const roomLastEvents = {}; // roomId -> last event text

  io.on("connection", (socket) => {
    const isAdmin = socket.handshake.query.isAdmin === "true";
    const roomId = socket.handshake.query.roomId || "default";

    // Join the isolated room matching the deployment link
    socket.join(roomId);
    
    if (!isAdmin) {
      roomUsers[roomId] = (roomUsers[roomId] || 0) + 1;
    }

    // Immediately update dashboard details for this specific room
    io.to(roomId).emit("status_update", {
      activeUsersCount: roomUsers[roomId] || 0,
      lastEvent: roomLastEvents[roomId] || "Joined Room"
    });

    console.log(`Socket connected: ${socket.id} (Admin: ${isAdmin}) joined room [${roomId}]`);

    // Handle incoming events from the Admin panel inside this room
    socket.on("trigger_event", (data) => {
      if (isAdmin) {
        roomLastEvents[roomId] = `Triggered ${data.event}`;
        
        // Broadcast the surprise to all non-admin client instances inside this room
        socket.to(roomId).emit("magical_event", data);

        // Notify admin panel about state updates in this room
        io.to(roomId).emit("status_update", {
          activeUsersCount: roomUsers[roomId] || 0,
          lastEvent: roomLastEvents[roomId]
        });
      }
    });

    socket.on("disconnect", () => {
      if (!isAdmin) {
        roomUsers[roomId] = Math.max(0, (roomUsers[roomId] || 1) - 1);
      }
      io.to(roomId).emit("status_update", {
        activeUsersCount: roomUsers[roomId] || 0,
        lastEvent: roomLastEvents[roomId] || "User Disconnected"
      });
      console.log(`Socket disconnected: ${socket.id} from room [${roomId}]`);
    });
  });
}
