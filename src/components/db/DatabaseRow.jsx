
import { Link } from "react-router-dom";
import { ArrowUpRight, Layers } from "lucide-react";
import DbTypeIcon from "./DbTypeIcon";
import StatusBadge from "@/components/dev/StatusBadge";
import { getDbType } from "@/lib/databases";

export default function DatabaseRow({ db, projects = [] }) {
  const type = getDbType(db.type);
  return (
    <Link
      to={`/databases/${db.id}`}
      className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/30"
    >
      <DbTypeIcon type={db.type} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{db.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {db.host || `db-${db.name}.fra1.nineteen.app`}:{db.port || type.port}
        </p>
      </div>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {type.label} {db.version}
      </span>
      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
        <Layers className="h-3 w-3 text-muted-foreground/50" />
        {projects.length}
      </span>
      <StatusBadge status={db.status} kind="database" />
      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition group-hover:text-foreground" />
    </Link>
  );
}