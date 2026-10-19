import type { Module } from '../ui/kit';
import m01 from './m01-mental-model';
import m02 from './m02-functions';
import m03 from './m03-database';
import m04 from './m04-transactions';
import m05 from './m05-sync-engine';
import m06 from './m06-backend-internals';
import m07 from './m07-platform-features';
import m08 from './m08-patterns';

export const modules: Module[] = [m01, m02, m03, m04, m05, m06, m07, m08];
