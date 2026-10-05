import { Link } from '@tanstack/react-router'
import { useAllEntities } from '../../app/context'
import { projectProgress } from '../../domain/lists'
import type { Project } from '../../domain/types'
import { Progress } from '../../ui/Progress'

/** A project as an item in a list (Today, Scheduled, Backlog, Area). */
export function ProjectRow({ project }: { project: Project }) {
  const e = useAllEntities()
  return (
    <li>
      <Link
        to="/project/$projectId"
        params={{ projectId: project.id }}
        className="flex min-h-[var(--row-height)] items-center gap-3 border-b border-hairline px-1 font-serif font-semibold hover:bg-sidebar/60"
      >
        <Progress
          {...projectProgress(e, project.id)}
          completed={project.status === 'completed'}
        />
        <span
          className={`truncate ${project.status !== 'open' ? 'text-text-secondary line-through' : ''}`}
        >
          {project.title || 'New Project'}
        </span>
      </Link>
    </li>
  )
}
