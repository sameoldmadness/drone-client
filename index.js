#!/usr/bin/env node

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

const WebSocket = require('ws');
const moment = require('moment');
const Drone = require('drone-node').Client;
const git = require('simple-git')(process.pwd);

const server = process.env.DRONE_SERVER;
const client = new Drone({
    url: server,
    token: process.env.DRONE_TOKEN
});

git._silentLogging = true;

function _parseGitRepository(data) {
    const splited = data.split(':')[1].split('.')[0].split('/');

    return { owner: splited[0], name: splited[1] };
}

function getGitRepository() {
    return new Promise((resolve, reject) => {
        git.listRemote(['--get-url'], (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(_parseGitRepository(data));
            }
        });
    });
}

function getLastDroneBuild({ owner, name }) {
    return client.getBuilds(owner, name)
        .then(builds => {
            return client.getBuild(owner, name, builds[0].number);
        });
}

function subscribeLog({ owner, name, build, job }) {
    return new Promise((resolve, reject) => {
        const domain = server.replace(/^https?:\/\//, '');
        const url = `wss://${domain}/ws/logs/${owner}/${name}/${build}/${job}`;

        const ws = new WebSocket(url);

        ws.on('message', data => {
            const json = JSON.parse(data);

            if (json.out) {
                log(`${json.proc}: ${json.out}`);
            }
        });

        ws.on('error', err => {
            if (err.message === 'Unexpected server response: 404') {
                resolve(err);
            } else {
                reject(err);
            }
        });

        ws.on('close', () => {
            reject();
        });
    });
}

function log() {
    console.log.apply(console, arguments); // eslint-disable-line
}

function logRepo(data) {
    log('Repository:');
    log('Owner: ', data.owner);
    log('Name:  ', data.name);
    log('--------------------------');
}

function logBuild(build) {
    log('Message:');
    log(build.message);
    log('--------------------------');
    log(`Event:    ${build.event}`);
    log(`Build:    ${build.number}`);
    log(`Author:   ${build.author} <${build.author_email}>`);
    log(`Commit:   ${build.link_url}`);
    log('--------------------------');
}

function logJob(job) {
    const start = moment(new Date(job.started_at * 1000));
    const finish = moment(new Date(job.finished_at * 1000));
    const format = 'DD.MM.YYYY HH:mm:ss';

    log(`Status:   ${job.status}`);
    log(`Started:  ${start.format(format)} (${start.fromNow()})`);
    log(`Finished: ${finish.format(format)} (${finish.fromNow()})`);
}

function logLink(data) {
    if (data.owner && data.name) {
        const url = `${server}/${data.owner}/${data.name}`;

        log('--------------------------');
        log(data.build ? url : `${url}/${data.build}`);
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
    .then(() => {
        return getLastDroneBuild(data);
    })
    .then(build => {
        logBuild(build);

        data.build = build.number;
        data.job = build.jobs[0].number;
        data._raw.build = build;
        data._raw.job = build.jobs[0]; // eslint-disable-line prefer-destructuring

        return;
    })
    .then(() => {
        return subscribeLog(data);
    })
    .then(() => {
        logJob(data._raw.job);
        logLink(data);
        process.exit(0);
    })
    .catch(err => {
        console.error('Catched error:', err);
        logLink(data);
        process.exit(1);
    });
