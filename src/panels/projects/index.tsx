import { ProjectsPanel } from './ProjectsPanel'
import { register } from './register'

export { ProjectsPanel }

register({ id: 'projects', title: 'Projects', hint: 'Every repo the app knows, and what starts in it', Component: ProjectsPanel })
