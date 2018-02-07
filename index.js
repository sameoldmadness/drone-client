#!/usr/bin/env node

process.env.NODE_TLS_REJECT_UNAUTHORIZED=0;

const WebSocket = require('ws');
const moment = require('moment');
const Drone = require('drone-node').Client;
const git = require('simple-git')(process.pwd);

git._silentLogging = true;
const client = new Drone({
	url: process.env.DRONE_SERVER,
	token: process.env.DRONE_TOKEN
});

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
	})
}

function getLastDroneBuild({owner, name}) {
	return client.getLastBuild(owner, name);
}

function getDroneBuildLog({owner, repo, build, job}) {
	return client.getBuildLogs(owner, repo, build, job);
}

function subscribeLog({owner, name, build, job}) {
	return new Promise((resolve, reject) => {
		const domain = process.env.DRONE_SERVER.replace(/^https?:\/\//, '');
		const url = `wss://${domain}/ws/logs/${owner}/${name}/${build}/${job}`;

		const ws = new WebSocket(url);
		 
		ws.on('message', function(data) {
			const json = JSON.parse(data);
			log(`${json.proc}: ${json.out}`);
		});

		ws.on('error', err => {
			if (err.message === 'Unexpected server response: 404') {
				resolve(err);
			}
			else {
				reject(err);
			}
		})

		ws.on('close', function() {
			reject();
		});
	});
}

function log() {
	console.log.apply(undefined, arguments);
};

const data = { _raw: {}};

getGitRepository()
	.then(({owner, name}) => {
		data.owner = owner;
		data.name = name;
        log('Repository:');
        log('Owner: ', owner);
        log('Name:  ', name);
        log('--------------------------');
	})
	.then(() => {
		return getLastDroneBuild(data);
	})
	.then(build => {
        log('Message:');
        log(build.message);
        log('--------------------------');
		log(`Event:    ${build.event}`);
		log(`Build:    ${build.number}`);
		log(`Author:   ${build.author} <${build.author_email}>`);
		log(`Commit:   ${build.link_url}`);
        log('--------------------------');

		data.build = build.number;
		data.job = build.jobs[0].number;
		data._raw.build = build; 
		data._raw.job = build.jobs[0]; 

		return;
	})
	.then(() => {
		return subscribeLog(data);
	})
	.then(() => {
		return data._raw.job;
	})
	.then((job) => {
		const start = moment(new Date(job.started_at * 1000));
		const finish = moment(new Date(job.finished_at * 1000));

		log(`Status:   ${job.status}`);
		log(`Started:  ${start.format('DD.MM.YYYY HH:mm:ss')} (${start.fromNow()})`);
		log(`Finished: ${finish.format('DD.MM.YYYY HH:mm:ss')} (${finish.fromNow()})`);
        log('--------------------------');
        log(`${process.env.DRONE_SERVER}/${data.owner}/${data.name}/${data.build}`)
		process.exit(0);
	})
	.catch(err => {
		console.error('Catched error:', err);
        if (data.owner && data.name) {
            log('--------------------------');
            log(`${process.env.DRONE_SERVER}/${data.owner}/${data.name}`)
        }
		process.exit(1);
	})