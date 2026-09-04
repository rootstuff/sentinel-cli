#!/usr/bin/env node

const createCli = require('../src/index');

const program = createCli();

program.parse(process.argv);
