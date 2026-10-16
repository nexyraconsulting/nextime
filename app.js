// GoDaddy cPanel "Setup Node.js App" (Phusion Passenger) startup file.
//
// Passenger loads this file as the application entry point and sets process.env.PORT
// to the Unix-domain socket it expects the app to listen on. The real API lives in
// server/server.js, which reads process.env.PORT and calls app.listen(PORT), so all
// this entry point has to do is require it.
//
// Node resolves the server's dependencies (express, pg, ...) from the node_modules
// folder installed at this app root by cPanel's "Run NPM Install" button.
require('./server/server.js');
