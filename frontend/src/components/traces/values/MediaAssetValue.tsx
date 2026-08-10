"use client";

import { AssetImage, assetSourceForPath } from "@/components/ui/asset-image";
import { Chip } from "@/components/ui/chip";
import { useAuth } from "@/providers/auth-provider";

import type { MediaAssetRefShape } from "@/components/traces/values/shape-guards";
import type { TraceValueViewProps } from "@/components/traces/values/TraceValueViews";

/**
 * A stored media reference a node carried (the query image on an image
 * query, a parsed page image). The thumbnail is the value: a path and a
 * pixel size say which file it is, not what was asked or matched.
 *
 * The scope its bytes are fetched from comes from the path itself — a value
 * renderer sits below any collection or dataset context — and a path under
 * no scope the client can reach keeps the type/size line alone rather than
 * an image that cannot load.
 */
export function MediaAssetValue({ value }: TraceValueViewProps) {
  const asset = value as MediaAssetRefShape;
  const { token } = useAuth();
  const source = assetSourceForPath(asset.path);
  const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip dot={false}>{asset.media_type}</Chip>
        {dimensions ? <Chip dot={false}>{dimensions}</Chip> : null}
      </div>
      {token && source ? (
        <AssetImage token={token} source={source} asset={asset} alt="Query image" />
      ) : null}
    </div>
  );
}
