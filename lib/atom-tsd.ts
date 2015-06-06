/// <reference path="../typings/tsd.d.ts"/>

import fs = require('fs');
import path = require('path');
import AtomTsdView = require('./atom-tsd-view');
import CommandOutputView = require('./out-view');
import child_process = require('child_process');

import {CompositeDisposable} from 'atom';

function cycleMessage(msg: string, fnPublish: (msg: string) => void) {
    var cycle = [
        `${msg}.`,
        `${msg}..`,
        `${msg}...`,
        `${msg}....`,
        `${msg}.....`
    ];

    var cycleIndex = 0;

    var fnWaiting = () => {
        if (cycleIndex > 4) {
            cycleIndex = 0;
        }
        fnPublish(cycle[cycleIndex++]);
    };

    var id = window.setInterval(fnWaiting, 500);

    return {
        cancel: () => {
            window.clearInterval(id);
        }
    };
}

class Tsd {
    public static install(out: (line: string) => void, path: string, query: string) {
        this.execTsdCommand(out, path, ['query', query, '--action', 'install', '--save', '--resolve']);
    }

    public static reinstall(out: (line: string) => void, path: string) {
        this.execTsdCommand(out, path, ['reinstall', '--save', '--overwrite']);
    }

    public static update(out: (line: string) => void, path: string) {
        this.execTsdCommand(out, path, ['update', '--save', '--overwrite']);
    }

    public static execTsdCommand(out: (line: string) => void, path: string, args: string[]) {
        var tsdMissing = false;
        var isWin = /^win/.test(process.platform);

        var cmd = child_process.spawn((isWin ? 'tsd.cmd' : 'tsd'), args, {cwd: path});

        cmd.on('error', function(err) {
            if (err.code === 'ENOENT' && err.syscall === 'spawn tsd' && err.path === 'tsd') {
                tsdMissing = true;
                out('--missing-tsd--');
            } else {
                throw err;
            }
        });

        cmd.stdout.on('data', (data) => {
            // console.log('tsd stdout: ' + data);
            if (data.toString().match(/\- [^\n]+\/[^\n]+\.d\.ts/ig)) {
                var regex = /\- ([^\n]+\/[^\n]+\.d\.ts)/igm;
                var match = regex.exec(data);
                while(match != null) {
                    out(match[1]);
                    match = regex.exec(data);
                }
            }
        });

        cmd.stderr.on('data ', function (data) {
            console.log('tsd stderr: ' + data);
        });

        cmd.on('close', function (code) {
            console.log('tsd child process exited with code ' + code);
            if (!tsdMissing) {
                out('--finish--');
            }
        });
    }
}

class AtomTsd {
    atomTsdView: any;
    outView: any;
    modalPanel: any;
    subscriptions: EventKit.CompositeDisposable;
    private _items: { displayName: string; name: string; }[] = [];

    constructor() {
        var defs = require('./repository.json');

        defs.content.forEach((def) => {
            if(def.project == def.name) {
                this._items.push({displayName: def.project + ' - ' + def.info.projectUrl, name: def.name});
            } else {
                this._items.push({displayName: def.name + ' (' + def.project + ') - ' + def.info.projectUrl, name: def.name});
            }
        });
    }

    public activate(state: any) {
        this.subscriptions = new CompositeDisposable();
        this.subscriptions.add(atom.commands.add('atom-workspace', 'tsd:install', () => this.install()));
        this.subscriptions.add(atom.commands.add('atom-workspace', 'tsd:reinstall', () => this.reinstall()));
        this.subscriptions.add(atom.commands.add('atom-workspace', 'tsd:update', () => this.update()));
    }

    public deactivate() {
        this.modalPanel.destroy();
        this.subscriptions.dispose();
        this.atomTsdView.destroy();
    }

    public serialize() {
        return {
            atomTsdViewState: this.atomTsdView.serialize()
        };
    }

    homeDirectory() {
        return process.env['HOME'] || process.env['USERPROFILE'] || '/';
    }

    workingDirectory() {
        var activePath, editor, ref, relative;

        editor = atom.workspace.getActiveTextEditor();
        activePath = editor != null ? editor.getPath() : void 0;
        relative = atom.project.relativizePath(activePath);

        if (activePath != null) {
            return relative[0] || path.dirname(activePath);
        } else {
            return ((ref = atom.project.getPaths()) != null ? ref[0] : void 0) || this.homeDirectory();
        }
    }

    public tsdIdMissing() {
        var answer = atom.confirm({
            message: 'TSD: It seems that you do not have installed TSD :(\n\nPlease install with:\n\n    npm install -g tsd',
            buttons: ['Ok']
        });
    }

    public reinstall() {
        var answer = atom.confirm({
            message: 'TSD: You really want to reinstall the typings?',
            buttons: ["Yes", "Cancel"]
        });

        if (answer === 0) {
            if (this.outView) {
                this.outView.detach();
            }

            this.outView = new CommandOutputView();
            this.outView.clean();
            this.outView.show();

            var waitMessage = cycleMessage('reinstalling', (msg: string) => {
                this.outView.setStatus(msg);
            });

            Tsd.update((line) => {
                if (line != '--finish--') {

                    if (line === '--missing-tsd--') {
                        waitMessage.cancel();
                        this.outView.close();
                        this.tsdIdMissing();
                    } else {
                        this.outView.addOutput(line);
                    }
                } else {
                    waitMessage.cancel();
                    this.outView.setStatus('All types have been reinstalled!');
                    this.outView.showCloseButton();
                }
            }, this.workingDirectory());
        }
    }

    public update() {
        var answer = atom.confirm({
            message: 'TSD: You really want to update the typings?',
            buttons: ["Yes", "Cancel"]
        });

        if (answer === 0) {
            if (this.outView) {
                this.outView.detach();
            }

            this.outView = new CommandOutputView();
            this.outView.clean();
            this.outView.show();

            var waitMessage = cycleMessage('updating', (msg: string) => {
                this.outView.setStatus(msg);
            });

            Tsd.update((line) => {
                if (line != '--finish--') {
                    if (line === '--missing-tsd--') {
                        waitMessage.cancel();
                        this.outView.close();
                        this.tsdIdMissing();
                    } else {
                        this.outView.addOutput(line);
                    }
                } else {
                    waitMessage.cancel();
                    this.outView.setStatus('All types have been updated!');
                    this.outView.showCloseButton();
                }
            }, this.workingDirectory());
        }
    }

    public install() {
        this.atomTsdView = new AtomTsdView(this._items, (def: any) => {
            var answer = atom.confirm({
                message: 'TSD: You really want to install the "' + def + '" typing with all of its dependencies?',
                buttons: ["Yes", "Cancel"]
            });

            if (answer === 0) {
                if (this.outView) {
                    this.outView.detach();
                }

                this.outView = new CommandOutputView();
                this.outView.clean();
                this.outView.show();

                var waitMessage = cycleMessage('installing', (msg: string) => {
                    this.outView.setStatus(msg);
                });

                Tsd.install((line) => {
                    if (line != '--finish--') {
                        if (line === '--missing-tsd--') {
                            waitMessage.cancel();
                            this.outView.close();
                            this.tsdIdMissing();
                        } else {
                            this.outView.addOutput(line);
                        }
                    } else {
                        waitMessage.cancel();
                        this.outView.setStatus('All types have been installed!');
                        this.outView.showCloseButton();
                    }
                }, this.workingDirectory(), def);
            }
        });

        if (this._items.length > 0) {
            this.atomTsdView.toggle();
        }
    }
}

export = new AtomTsd;
