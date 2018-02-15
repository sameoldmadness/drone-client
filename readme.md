# Drone CLI build viewer ![npm version](https://img.shields.io/npm/v/drone-client.svg)

# Install

You need to set variables: 
```
DRONE_SERVER=https://your.drone.server
DRONE_TOKEN=your_token
```

```
npm install drone-client -g --registry=https://registry.npmjs.org
```

# Usage

Go to the folder with git repository, call ```drone-client``` -you will see information about the last build of this repository in drone CI or you will follow the process of building the last build.

By default, drone client will use origin git remote, but you can specify necessary:

```bash
# List all remotes
git remote --verbose

# View last build for specified remote
drone-client upstream
```

By default, drone client will use last build despite the user login, but you can specify it:

```bash
# View last build for specified user login
drone-client upstream octocat
```
