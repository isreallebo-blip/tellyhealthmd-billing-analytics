import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function MultiSelect({
  label,
  options,
  values,
  onChange,
  placeholder = "Select…",
  className,
}: {
  label?: string;
  options: string[];
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  return (
    <div className={cn("min-w-0", className)}>
      {label && <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="w-full justify-between h-9 font-normal">
            <span className="truncate text-left">
              {values.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : values.length <= 2 ? (
                values.join(", ")
              ) : (
                <Badge variant="secondary">{values.length} selected</Badge>
              )}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[260px] pointer-events-auto" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>No options.</CommandEmpty>
              <CommandGroup>
                {values.length > 0 && (
                  <CommandItem onSelect={() => onChange([])} className="text-muted-foreground">
                    <X className="h-4 w-4 mr-2" /> Clear selection
                  </CommandItem>
                )}
                {options.map((opt) => {
                  const sel = values.includes(opt);
                  return (
                    <CommandItem key={opt} onSelect={() => toggle(opt)}>
                      <Check className={cn("h-4 w-4 mr-2", sel ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{opt}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
