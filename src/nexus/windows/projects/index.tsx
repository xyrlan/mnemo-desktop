import { registerWindow } from '../../ui/windows'
import { ProjectsWindow } from './ProjectsWindow'

export { ProjectsWindow }

// The bar's PROJECTS button opens it (`openWindow('projects')`, params `{}`).
registerWindow({ id: 'projects', title: 'Projects', width: 780, render: (_params, close) => <ProjectsWindow close={close} /> })
