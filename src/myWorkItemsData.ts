import {
    getActiveWorkItemIds,
    getRecentlyChangedWorkItemIds,
    getFollowedWorkItemIds,
    getCreatedWorkItemIds,
    getCommentMentions,
    getWorkItems,
    buildWorkItemUrl,
} from "./azdo.js";
import type { WorkItemSummary } from "./types.js";

const MY_WORK_ITEM_FIELDS = [
    "System.Id",
    "System.Title",
    "System.WorkItemType",
    "System.State",
    "Microsoft.VSTS.Common.Priority",
    "System.ChangedDate",
    "System.CreatedDate",
    "Microsoft.VSTS.Common.ClosedDate",
    "System.AssignedTo",
    "System.CreatedBy",
    "System.Tags",
];

const MENTION_SCAN_WINDOW_DAYS = 30;

function toWorkItemSummary(wi: any): WorkItemSummary {
    return {
        id: wi.id,
        title: wi.fields["System.Title"],
        type: wi.fields["System.WorkItemType"],
        state: wi.fields["System.State"],
        priority: wi.fields["Microsoft.VSTS.Common.Priority"],
        changedDate: wi.fields["System.ChangedDate"],
        createdDate: wi.fields["System.CreatedDate"],
        closedDate: wi.fields["Microsoft.VSTS.Common.ClosedDate"],
        url: buildWorkItemUrl(wi.id),
        assignee: wi.fields["System.AssignedTo"]
            ? {
                  displayName: wi.fields["System.AssignedTo"].displayName,
                  uniqueName: wi.fields["System.AssignedTo"].uniqueName,
              }
            : undefined,
        creator: wi.fields["System.CreatedBy"]
            ? {
                  displayName: wi.fields["System.CreatedBy"].displayName,
                  uniqueName: wi.fields["System.CreatedBy"].uniqueName,
              }
            : undefined,
        tags: wi.fields["System.Tags"]
            ? wi.fields["System.Tags"]
                  .split(";")
                  .map((tag: string) => tag.trim())
                  .filter(Boolean)
            : undefined,
    };
}

export async function getAssignedWorkItems(): Promise<WorkItemSummary[]> {
    const ids = await getActiveWorkItemIds();
    const items = await getWorkItems(ids, MY_WORK_ITEM_FIELDS);

    return items.map(toWorkItemSummary);
}

export async function getMentionedWorkItems(): Promise<WorkItemSummary[]> {
    const ids = await getRecentlyChangedWorkItemIds(
        MENTION_SCAN_WINDOW_DAYS
    );
    const mentionsById = new Map<number, string[]>();

    await Promise.all(
        ids.map(async (id) => {
            const mentions = await getCommentMentions(id);

            if (mentions.length) {
                mentionsById.set(id, mentions);
            }
        })
    );

    if (!mentionsById.size) {
        return [];
    }

    const items = await getWorkItems(
        [...mentionsById.keys()],
        MY_WORK_ITEM_FIELDS
    );

    return items.map((wi) => ({
        ...toWorkItemSummary(wi),
        mentions: mentionsById.get(wi.id) ?? [],
    }));
}

export async function getFollowedWorkItems(): Promise<WorkItemSummary[]> {
    const ids = await getFollowedWorkItemIds();
    const items = await getWorkItems(ids, MY_WORK_ITEM_FIELDS);

    return items.map(toWorkItemSummary);
}

export async function getCreatedWorkItems(): Promise<WorkItemSummary[]> {
    const ids = await getCreatedWorkItemIds();
    const items = await getWorkItems(ids, MY_WORK_ITEM_FIELDS);

    return items.map(toWorkItemSummary);
}
