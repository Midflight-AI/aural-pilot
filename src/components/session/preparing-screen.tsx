import { Loader2 } from "lucide-react";
import { InterviewHeader } from "@/components/brand/ramp";

export function PreparingScreen({
  title = "Preparing your interview...",
  description = "This will only take a moment.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <InterviewHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-lg font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
