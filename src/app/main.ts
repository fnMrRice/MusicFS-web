import { createLayout } from '../ui/layout';
import { Application } from './bootstrap';
import { LibraryApi } from '../api/library';
import { LibraryController } from '../library/controller';
import { FileListView } from '../ui/file-list';
import '../ui/styles.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing application root');
const layout = createLayout(app);
const application = new Application(layout);
const library = new LibraryController(new LibraryApi(application.client), new FileListView(layout.library));
application.onLogin = () => library.open();
application.onLogout = () => library.clear();
void application.connect();
