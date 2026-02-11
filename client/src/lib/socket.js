import { io } from 'socket.io-client';
import { API_URL } from '../utils/constants';

let socket = null;

export function connectSocket(token) {
  if (socket?.connected) {
    socket.disconnect();
  }

  socket = io(API_URL || window.location.origin, {
    auth: { token },
    transports: ['websocket'], // Skip long-polling — faster connection
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// Promise wrapper for socket.io request/response pattern
export function socketRequest(event, data = {}) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      return reject(new Error('Socket not connected'));
    }

    socket.emit(event, data, (response) => {
      if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}
