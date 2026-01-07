# Chat Bot Desktop

A scalable real-time chat application built with Electron, React, Node.js, and MongoDB.

## Project Structure

The project is organized into three main folders, keeping the frontend, backend, and desktop wrapper separate:

### 1. `client/` (Frontend)
Contains the React application powered by Vite.
- **`src/`**: Main source code for the UI components, pages, and logic.
- **`public/`**: Static assets like icons and images.
- **`test-turn-server.html`**: A standalone tool to test TURN server connectivity.
- **`vite.config.js`**: Configuration for the Vite bundler.

### 2. `server/` (Backend)
Contains the Node.js/Express server and Socket.IO logic.
- **`src/`**: Server entry point and logic (API routes, socket handlers).
- **`uploads/`**: Stores files shared by users in chats.
- **`.env`**: Configuration for database connections and secrets (do not commit this).

### 3. `electron/` (Desktop Shell)
Contains the Electron specific code to wrap the web app as a desktop application.
- **`main.js`**: The main process file that creates the application window and handles system events.

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB (Local or Atlas)

### Installation
1.  **Install Dependencies**:
    ```bash
    npm install
    ```
    This will install dependencies for the root, client, server, and electron folders appropriately.

2.  **Configuration**:
    - **Server**: Copy `server/.env.example` to `server/.env` and update your MongoDB URI.
    - **Client**: (Optional) Check `client/.env.example` if you need custom TURN servers.

### Running the App
To start the entire stack (Server + Client + Electron) in development mode:

```bash
npm run dev
```

- **API**: http://13.205.101.250:4000
- **Frontend**: http://13.205.101.250:5173

### Building for Production
To build the desktop application:

1.  Build the client and server:
    ```bash
    npm run build
    ```
2.  Package the executable (optional, requires electron-builder config):
    ```bash
    npm run dist
    ```

## Features
- Real-time messaging with Socket.IO
- Audio & Video calls (WebRTC)
- File sharing
- End-to-end encryption support
- User status indicators


