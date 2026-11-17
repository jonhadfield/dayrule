import { Link } from '@tanstack/react-router'
import { useAllEntities } from '../../app/context'
import { projectProgress } from '../../domain/lists'
import type { Project } from '../../domain/types'
import { Progress } from '../../ui/Progress'
import { RowLeading } from '../../ui/RowLeading'

/** A project as an item in a list (Today, Scheduled, Backlog, Area). */
export function ProjectRow({ project }: { project: Project }) {
  const e = useAllEntities()
  return (
    <li>
      <Link
        to="/project/$projectId"
        params={{ projectId: project.id }}
        className="flex min-h-[var(--row-height)] items-center gap-[var(--row-glyph-spacing)] border-b border-hairline font-serif font-semibold hover:bg-sidebar/60"
      >
        <RowLeading>
          <Progress
            {...projectProgress(e, project.id)}
            completed={project.status === 'completed'}
          />
        </RowLeading>
        <span
          className={`truncate ${project.status !== 'open' ? 'text-text-secondary line-through' : ''}`}
        >
          {project.title || 'New Project'}
        </span>
      </Link>
    </li>
  )
}
