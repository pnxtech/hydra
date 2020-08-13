![](hydra.png)

[![npm version](https://badge.fury.io/js/hydra.svg)](https://badge.fury.io/js/hydra) <span class="badge-npmdownloads"><a href="https://npmjs.org/package/hydra" title="View this project on NPM"><img src="https://img.shields.io/npm/dm/hydra.svg" alt="NPM downloads" /></a></span> [![Build Status](https://travis-ci.org/flywheelsports/hydra.svg?branch=master)](https://travis-ci.org/flywheelsports/hydra)

Hydra is a NodeJS package which facilitates building distributed applications such as Microservices.

Hydra offers features such as service discovery, distributed messaging, message load balancing, logging, presence, and health monitoring. It was announced at [EmpireNode 2016](http://www.dev-conferences.com/en/talks/node-microservices-using-hydra-carlos-justiniano/1536).

Install the latest stable version via `npm install hydra --save`

[See our quick start guide](https://www.hydramicroservice.com/docs/quick-start/) and [sample projects](https://www.hydramicroservice.com/resources/#resources)

If you're just getting started with Node Microservices and you have ExpressJS experience you should first look at our [HydraExpress](https://github.com/flywheelsports/hydra-express) project.

> If you want a lighter-weight Express integration or you're using Hapi, Koa, Sails.js, Restify or Restana then checkout the [Hydra Integration Project](https://www.npmjs.com/package/hydra-integration).

### Documentation

Visit our dedicated documentation site for hydra at: https://www.hydramicroservice.com

Hydra works great on AWS using Docker containers and Swarm mode, see: https://www.hydramicroservice.com/docs/docker/docker.html

### Join us on Slack!

Are you using or planning on using Hydra on your project? Join us on Slack for more direct support. https://fwsp-hydra.slack.com To join, email cjus34@gmail.com with your desired username and email address (for invite).

### Related projects

There are many projects on NPM which contain the name `hydra`. The following are official projects related to the Hydra - microservice library.

* [Hydra](https://github.com/flywheelsports/hydra): hydra core project for use with Non-ExpressJS apps
* [Hydra-Express](https://github.com/flywheelsports/hydra-express): hydra for ExpressJS developers
* [Hydra-Integration](https://www.npmjs.com/package/hydra-integration): Integrating third-party Node.js web frameworks with Hydra
* [Hydra-Router](https://github.com/flywheelsports/hydra-router): A service-aware socket and HTTP API router
* [Hydra-cli](https://github.com/flywheelsports/hydra-cli): a hydra commandline client for interacting with Hydra-enabled applications
* [Hydra Generator](https://github.com/flywheelsports/generator-fwsp-hydra): A Yeoman generator for quickly building hydra-based projects
* [Hydra-plugin-rpc](https://www.npmjs.com/package/hydra-plugin-rpc): Create and consume remote procedure calls in hydra with ease
* [Hydra-Cluster](https://github.com/cjus/hydra-cluster): A compute cluster based on Hydra
* [UMF](https://github.com/cjus/umf): Universal Message Format, a messaging specification for routable messages

### Examples

* [A sample hello-service project](https://github.com/cjus/hello-service)
* [Hydra Hot Potato Service - an example of distributed messaging](https://github.com/cjus/hpp-service)
* [Hydra Message Relay - processing WebSocket calls via HydraRouter](https://github.com/cjus/hydra-message-relay)

### Articles

* [Tutorial: Building ExpressJS-based microservices using Hydra](https://community.risingstack.com/tutorial-building-expressjs-based-microservices-using-hydra/)
* [Building a Microservices Example Game with Distributed Messaging](https://community.risingstack.com/building-a-microservices-example-game-with-distributed-messaging/)
* [Deploying Node.js Microservices to AWS using Docker](https://community.risingstack.com/deploying-node-js-microservices-to-aws-using-docker/)
* [Using Docker Swarm for Deploying Node.js Microservices](https://community.risingstack.com/using-docker-swarm-for-deploying-nodejs-microservices/)

### Special thanks

A special thanks to Michael Stillwell for generously transferring his `Hydra` project name on NPM!
