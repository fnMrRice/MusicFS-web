import { createLayout } from '../ui/layout';
import { Application } from './bootstrap';
import '../ui/styles.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing application root');
const application = new Application(createLayout(app));
void application.connect();
