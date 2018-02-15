#!/usr/bin/env node

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const WebSocket = require('ws');
const moment = require('moment');
const Drone = require('drone-node').Client;
const git = require('simple-git')(process.pwd);
const colors = require('colors/safe');
const debug = require('debug')('drone:client');

const server = process.env.DRONE_SERVER;
const client = new Drone({
    url: server,
    token: process.env.DRONE_TOKEN
});

git._silentLogging = true;

function _parseGitRepository(data) {
    const remoteName = process.argv[2] || 'origin';
    const { refs: { push: url } } = data
        .find(remote => remote.name === remoteName);

    const splited = url.split(':')[1].split('.')[0].split('/');

    return { owner: splited[0], name: splited[1] };
}

function getGitRepository() {
    debug('Arguments:');
    debug(process.argv);

    return new Promise((resolve, reject) => {
        git.getRemotes(true, (err, data) => {
            if (err) {
                reject(err);
            } else {
                const repo = _parseGitRepository(data);

                debug('Get git repository');
                debug(repo);

                resolve(repo);
            }
        });
    });
}

function getDroneBuild({ owner, name }) {
    if (process.argv[3]) {
        return getDroneLastAuthorBuild(owner, name);
    }

    return getDroneLastBuild(owner, name);
}

const errorMessages = {
    404: 'There is not a single build yet!',
    500: 'Drone responded with 500 error... :('
};

function getDroneLastBuild(owner, name) {
    return client
        .getLastBuild(owner, name)
        .catch(err => {
            if (errorMessages[err.statusCode]) {
                log(errorMessages[err.statusCode]);

                debug('Get drone last build');
                debug(err);

                process.exit(1);
            }

            return Promise.reject(err);
        });
}

function getDroneLastAuthorBuild(owner, name) {
    return client
        .getBuilds(owner, name)
        .then(builds => {
            const [, , author] = process.argv;
            const lastAuthorBuild = builds.find(build => build.author === author);

            if (!lastAuthorBuild) {
                log(`There is not a single build yet by ${author}!`);

                debug('Get drone last author build');
                debug(builds);

                process.exit(1);
            }

            return client.getBuild(owner, name, lastAuthorBuild.number);
        });
}

function writeMessage(data) {
    if (data.out) {
        let pipe = `${data.proc}:`;
        let text = data.out;

        if (pipe.length <= 10) {
            pipe += (new Array(10 - pipe.length)).join(' ');
        }

        if (text[0] === '+') {
            text = colors.bold.green(text);
        }

        log(`${pipe} ${text}`);
    }
}
function logBuildLog(data) {
    if (['success', 'failure'].includes(data._raw.job.status)) {
        return showLog(data);
    }

    return subscribeLog(data);
}

function showLog({ owner, name, build, _raw: { job: { number: job } } }) {
    return client
        .getBuildLogs(owner, name, build, job)
        .then(logs => {
            for (const record of logs) {
                writeMessage(record);
            }
        });
}

function subscribeLog({ owner, name, build, job }) {
    return new Promise((resolve, reject) => {
        const domain = server.replace(/^https?:\/\//, '');
        const url = `wss://${domain}/ws/logs/${owner}/${name}/${build}/${job}`;

        const ws = new WebSocket(url);

        ws.on('message', data => {
            writeMessage(JSON.parse(data));
        });

        ws.on('error', err => {
            if (err.message === 'Unexpected server response: 404') {
                resolve(err);
            } else {
                reject(err);
            }
        });

        ws.on('close', () => {
            resolve();
        });
    });
}

function log() {
    console.log.apply(console, arguments); // eslint-disable-line
}

function logRepo(data) {
    log(`Repository: ${data.owner}/${data.name}`);
    log('--------------------------');
}

function logBuild(build, data) {
    log(`Message:  ${colors.italic.bold(build.message.replace(/\n/, ' '))}`);
    log('--------------------------');
    log(`Event:    ${build.event}`);
    log(`Build:    ${build.number} ${server}/${data.owner}/${data.name}/${build.number}`);
    log(`Author:   ${build.author} <${build.author_email}>`);
    log(`Commit:   ${build.link_url}`);
    log('--------------------------');
}

const statusColors = {
    skipped: 'green',
    pending: 'yellow',
    running: 'yellow',
    success: 'green',
    failure: 'red',
    killed: 'red',
    error: 'red'
};

function logJob(job) {
    const start = moment(new Date(job.started_at * 1000));
    const finish = moment(new Date(job.finished_at * 1000));
    const format = 'DD.MM.YYYY HH:mm:ss';

    log('--------------------------');
    log(`Status:   ${colors[statusColors[job.status]].bold(job.status)}`);
    log(`Started:  ${start.format(format)} (${start.fromNow()})`);
    log(`Finished: ${finish.format(format)} (${finish.fromNow()})`);
}

function logLink(data) {
    if (data.owner && data.name) {
        const url = `${server}/${data.owner}/${data.name}`;

        log('--------------------------');
        log(`${url}/${data.build}`);
    }
}

const data = { _raw: {} };

getGitRepository()
    .then(repo => {
        data.owner = repo.owner;
        data.name = repo.name;
        logRepo(repo);

        return;
    })
    .then(() => getDroneBuild(data))
    .then(build => {
        logBuild(build, data);

        data.build = build.number;

        data.job = build.jobs[0].number;
        data._raw.build = build;
        data._raw.job = build.jobs[0]; // eslint-disable-line prefer-destructuring

        return;
    })
    .then(() => {
        return logBuildLog(data);
    })
    .then(() => {
        logJob(data._raw.job);
        logLink(data);
        process.exit(0);
    })
    .catch(err => {
        console.error('Catched error:', err);
        process.exit(1);
    });
