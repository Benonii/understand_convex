import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.hourly('prune lab messages', { minuteUTC: 7 }, internal.lab.pruneMessages, {});
export default crons;
