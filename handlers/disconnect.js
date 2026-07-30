// handlers/disconnect.js
// Socket handler: disconnect (full cleanup including friend offline notifications)

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, state, cords, _removeFromIpTracking, ratelimit, sessionTokens } = deps;

    // ------------------------------------------------------------------
    // Disconnect: full cleanup
    // ------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      try {
        // Decrement global connection counter
        ratelimit.decrementConnections();
        // Remove from concurrent connection tracking
        _removeFromIpTracking();

        const disconnectingUser = state.users.get(socket.id);
        if (!disconnectingUser) {
          console.log(`[disconnect] Unknown socket ${socket.id} (${reason})`);
          return;
        }

        // Save account data on disconnect
        const accKey = socketAccountMap.get(socket.id);
        const wasTemp = accKey ? accounts.isTempAccount(accKey) : true;

        // Notify friends this user went offline (before removing from map)
        if (accKey && !wasTemp) {
          try {
            var friendsData = accounts.getFriendsData(accKey);
            if (friendsData && friendsData.friends.length > 0) {
              for (var fi = 0; fi < friendsData.friends.length; fi++) {
                var fk = friendsData.friends[fi].key;
                for (var [sid, skey] of socketAccountMap) {
                  if (skey === fk && sid !== socket.id) {
                    var fSocket = io.sockets.sockets.get(sid);
                    if (fSocket) fSocket.emit('friend_status_changed', { key: accKey, online: false });
                  }
                }
              }
            }
          } catch (_) { /* don't let friend notify fail block disconnect */ }
        }

        if (accKey) {
          if (wasTemp) {
            // Temp account: delete entirely (progress lost)
            accounts.deleteAccount(accKey);
          } else {
            // Permanent account: save lastSeen and clear DMs
            const acc = accounts.loadAccount(accKey);
            if (acc) {
              acc.lastSeen = Date.now();
              // Wipe DMs on disconnect — messages are ephemeral
              if (acc.dms) {
                acc.dms = { conversations: {} };
              }
              accounts.saveAccount(acc);
            }
          }
          socketAccountMap.delete(socket.id);
        }

        // Clean up session tokens issued to this socket
        if (sessionTokens) {
          for (const [token, data] of sessionTokens) {
            if (data.socketId === socket.id) {
              sessionTokens.delete(token);
            }
          }
        }

        // Clean up cords and messages for anonymous/temp users
        if (wasTemp) {
          cords.deleteByAuthorId(socket.id);
          state.removeMessagesByAuthor(socket.id);
        }

        const userName = disconnectingUser.name;
        const roomCodes = new Set(disconnectingUser.roomIds);

        // Track which were public for updating room lists
        const hadPublicRooms = [];
        for (const code of roomCodes) {
          const room = state.rooms.get(code);
          if (room && room.isPublic) hadPublicRooms.push(code);

          socket.to(code).emit('user_left', {
            roomCode: code,
            user: { id: disconnectingUser.id, name: userName, color: disconnectingUser.color, tag: disconnectingUser.tag },
          });
        }

        // Clean up voice rooms: broadcast voice_user_left to any voice channels
        const allRooms = socket.rooms;
        for (const roomName of allRooms) {
          if (roomName.startsWith('voice:')) {
            const channelId = roomName.slice(6);
            socket.to(roomName).emit('voice_user_left', {
              channelId: channelId,
              user: { id: disconnectingUser.id, name: userName, color: disconnectingUser.color, tag: disconnectingUser.tag },
            });
          }
        }


        state.removeUser(socket.id);

        // Update public rooms list if user was in any public rooms
        if (hadPublicRooms.length > 0) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[disconnect] ${userName} (${socket.id}) -- ${reason}`);
      } catch (err) {
        console.error('[disconnect] Error during cleanup:', err.message);
        try { state.removeUser(socket.id); } catch (_) { /* nothing left to do */ }
      }
    });
  }
};
