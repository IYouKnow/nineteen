import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ImageTagSelect lists the published tags of a Docker image so the user can pin
// a version. Falls back to a free-text "latest" when tags can't be loaded.
export default function ImageTagSelect({ image, value, onChange, className }) {
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["dockerhub-tags", image],
    queryFn: () => api.dockerhub.tags(image, 50),
    enabled: !!image,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const options = tags.map((t) => t.name);
  const hasValue = value && options.includes(value);

  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={isLoading ? "Loading tags…" : "Select a tag"} />
      </SelectTrigger>
      <SelectContent>
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading tags…
          </div>
        )}
        {value && !hasValue && <SelectItem value={value}>{value}</SelectItem>}
        {options.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
        {!isLoading && options.length === 0 && (
          <SelectItem value="latest">latest</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
