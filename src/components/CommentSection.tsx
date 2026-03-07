'use client';

import { useState } from 'react';
import { Send, Trash2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useEventComments } from '@/hooks/useEventComments';
import { timeAgo } from '@/lib/time-parse';
import { getDisplayName, getDisplayInitial } from '@/lib/user-display';

interface CommentSectionProps {
  eventId: string;
  commentCount?: number;
}

export function CommentSection({ eventId, commentCount = 0 }: CommentSectionProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const { comments, loading, addComment, deleteComment } = useEventComments(
    expanded ? eventId : null
  );
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'friends'>('public');

  const handleSubmit = async () => {
    if (!text.trim()) return;
    await addComment(text, visibility);
    setText('');
  };

  if (!expanded) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
        className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        {commentCount > 0 ? `${commentCount} comment${commentCount !== 1 ? 's' : ''}` : 'Comments'}
      </button>
    );
  }

  return (
    <div className="mt-2 border-t border-stone-700/50 pt-2" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <button
        onClick={() => setExpanded(false)}
        className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors cursor-pointer mb-2"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>
          {comments.length > 0 ? `${comments.length} comment${comments.length !== 1 ? 's' : ''}` : 'Comments'}
        </span>
      </button>

      {/* Comments list */}
      {loading ? (
        <div className="text-xs text-stone-500 py-2">Loading...</div>
      ) : (
        <div className="max-h-[200px] overflow-y-auto space-y-2 mb-2">
          {comments.map((comment) => {
            const name = getDisplayName(comment);
            const initial = getDisplayInitial(comment);

            return (
              <div key={comment.id} className="flex gap-2 group/comment">
                <div className="w-6 h-6 rounded-full bg-stone-800 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-medium text-stone-300">{initial}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-stone-300">{name}</span>
                    <span className="text-[10px] text-stone-600">{timeAgo(comment.created_at)}</span>
                    {comment.visibility === 'friends' && (
                      <span className="text-[9px] text-blue-400/60 border border-blue-400/30 rounded px-1">friends</span>
                    )}
                    {user && comment.user_id === user.id && (
                      <button
                        onClick={() => deleteComment(comment.id)}
                        className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-stone-600 hover:text-red-400 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-stone-400 leading-relaxed break-words">{comment.text}</p>
                </div>
              </div>
            );
          })}
          {comments.length === 0 && !loading && (
            <p className="text-xs text-stone-600 py-1">No comments yet</p>
          )}
        </div>
      )}

      {/* Input */}
      {user && (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-1 bg-stone-800/50 border border-stone-600 rounded-lg px-2 py-1.5">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Add a comment..."
              maxLength={500}
              className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 outline-none min-w-0"
            />
            <button
              onClick={() => setVisibility(visibility === 'public' ? 'friends' : 'public')}
              className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 cursor-pointer transition-colors ${
                visibility === 'friends'
                  ? 'border-blue-400/40 text-blue-400 bg-blue-400/10'
                  : 'border-stone-600 text-stone-500 hover:text-stone-400'
              }`}
              title={visibility === 'public' ? 'Visible to everyone' : 'Visible to friends only'}
            >
              {visibility === 'public' ? 'public' : 'friends'}
            </button>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="p-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-stone-800 disabled:text-stone-500 text-stone-900 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
