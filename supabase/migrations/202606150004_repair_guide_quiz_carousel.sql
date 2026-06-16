alter table public.guide_quizzes
drop constraint if exists guide_quizzes_guide_id_key;

with duplicate_quizzes as (
  select
    id,
    row_number() over (
      partition by guide_id, question
      order by is_active desc, created_at asc, id asc
    ) as row_number
  from public.guide_quizzes
)
delete from public.guide_quizzes as gq
using duplicate_quizzes as duplicate
where gq.id = duplicate.id
  and duplicate.row_number > 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guide_quizzes_guide_id_question_key'
      and conrelid = 'public.guide_quizzes'::regclass
  ) then
    alter table public.guide_quizzes
    add constraint guide_quizzes_guide_id_question_key unique (guide_id, question);
  end if;
end $$;

drop function if exists public.submit_guide_quiz(uuid, text);

create or replace function public.ensure_guide_quiz_question_count(target_guide_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.guide_quizzes (
    guide_id,
    question,
    answer_options,
    correct_answer,
    explanation,
    is_active
  )
  select
    g.id,
    seed.question,
    seed.answer_options,
    seed.correct_answer,
    seed.explanation,
    true
  from public.guides as g
  cross join (
    values
      (
        'Which habit best turns this guide into safer practice?',
        '["Write a simple plan before acting","Copy another trader without context","Skip risk limits","Rush into leverage"]'::jsonb,
        'Write a simple plan before acting',
        'A written plan keeps the guide actionable and helps prevent emotional decisions.'
      ),
      (
        'What should you do before risking capital on an idea from this guide?',
        '["Define invalidation and position risk","Assume the setup cannot fail","Ignore fees and liquidation risk","Increase size to learn faster"]'::jsonb,
        'Define invalidation and position risk',
        'Every idea needs a clear invalidation point and risk amount before capital is exposed.'
      ),
      (
        'How should ASEKE TRADE education examples be treated?',
        '["As educational examples, not financial advice","As guaranteed trading signals","As a promise of profit","As a replacement for personal responsibility"]'::jsonb,
        'As educational examples, not financial advice',
        'The platform teaches concepts and frameworks; every user remains responsible for their own decisions.'
      ),
      (
        'What is the best next step after reading a new market concept?',
        '["Review it slowly and practice with small risk","Use maximum leverage immediately","Share private wallet details","Ignore security checks"]'::jsonb,
        'Review it slowly and practice with small risk',
        'New concepts should be practiced carefully before they are used with meaningful capital.'
      ),
      (
        'Which behavior supports long-term learning?',
        '["Journal decisions and review outcomes","Chase every candle","Hide mistakes from review","Change rules after every loss"]'::jsonb,
        'Journal decisions and review outcomes',
        'A review habit turns lessons, wins, and losses into useful feedback.'
      )
  ) as seed(question, answer_options, correct_answer, explanation)
  where g.id = target_guide_id
    and g.is_archived = false
  on conflict (guide_id, question) do update set
    answer_options = excluded.answer_options,
    correct_answer = excluded.correct_answer,
    explanation = excluded.explanation,
    is_active = true,
    updated_at = now();
end;
$$;

create or replace function public.get_guide_quiz(target_guide_id uuid)
returns table (
  id uuid,
  guide_id uuid,
  question text,
  answer_options jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_guide_id is null then
    raise exception 'Guide is required';
  end if;

  if not public.can_access_guide(target_guide_id) then
    raise exception 'Guide is not available to this account';
  end if;

  perform public.ensure_guide_quiz_question_count(target_guide_id);

  return query
  select gq.id, gq.guide_id, gq.question, gq.answer_options
  from public.guide_quizzes as gq
  where gq.guide_id = target_guide_id
    and gq.is_active = true
  order by gq.created_at asc, gq.id asc
  limit 5;
end;
$$;

create or replace function public.submit_guide_quiz(
  target_guide_id uuid,
  selected_answers jsonb
)
returns table (
  passed boolean,
  xp_awarded integer,
  total_xp integer,
  level integer,
  already_awarded boolean,
  correct_answer text,
  explanation text,
  score integer,
  total_questions integer,
  correct_answers jsonb,
  explanations jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  quiz record;
  guide_reward integer;
  inserted_amount integer;
  next_profile record;
  has_existing_award boolean;
  submitted_answer text;
  first_quiz_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Login is required to earn XP';
  end if;

  if target_guide_id is null then
    raise exception 'Guide is required';
  end if;

  if selected_answers is null or jsonb_typeof(selected_answers) <> 'object' then
    raise exception 'Quiz answers are required';
  end if;

  if not public.can_access_guide(target_guide_id) then
    raise exception 'Guide is not available to this account';
  end if;

  perform public.ensure_guide_quiz_question_count(target_guide_id);

  score := 0;
  total_questions := 0;
  correct_answers := '{}'::jsonb;
  explanations := '{}'::jsonb;

  for quiz in
    select gq.*
    from public.guide_quizzes as gq
    where gq.guide_id = target_guide_id
      and gq.is_active = true
    order by gq.created_at asc, gq.id asc
    limit 5
  loop
    total_questions := total_questions + 1;
    if first_quiz_id is null then
      first_quiz_id := quiz.id;
    end if;

    submitted_answer := selected_answers ->> quiz.id::text;
    if public.normalize_answer(submitted_answer) = public.normalize_answer(quiz.correct_answer) then
      score := score + 1;
    end if;

    correct_answers := correct_answers || jsonb_build_object(quiz.id::text, quiz.correct_answer);
    explanations := explanations || jsonb_build_object(quiz.id::text, quiz.explanation);
  end loop;

  if total_questions = 0 then
    raise exception 'This guide does not have an active quiz yet';
  end if;

  select g.xp_reward
  into guide_reward
  from public.guides as g
  where g.id = target_guide_id;

  passed := total_questions = 5 and score = total_questions;

  select exists (
    select 1
    from public.xp_transactions as xt
    where xt.user_id = auth.uid()
      and xt.source_type = 'guide'
      and xt.source_id = target_guide_id
  )
  into has_existing_award;

  inserted_amount := 0;

  if passed then
    insert into public.xp_transactions (
      user_id,
      amount,
      source_type,
      source_id,
      description
    )
    values (
      auth.uid(),
      guide_reward,
      'guide',
      target_guide_id,
      'Guide quiz passed'
    )
    on conflict (user_id, source_type, source_id) do nothing
    returning amount into inserted_amount;

    inserted_amount := coalesce(inserted_amount, 0);

    if inserted_amount > 0 then
      insert into public.profiles (id, total_xp)
      values (auth.uid(), inserted_amount)
      on conflict (id) do update set
        total_xp = public.profiles.total_xp + excluded.total_xp;
    end if;
  end if;

  insert into public.guide_completions (
    user_id,
    guide_id,
    guide_quiz_id,
    selected_answer,
    quiz_passed,
    xp_awarded,
    completed_at
  )
  values (
    auth.uid(),
    target_guide_id,
    first_quiz_id,
    selected_answers::text,
    passed,
    inserted_amount,
    case when passed then now() else null end
  )
  on conflict (user_id, guide_id) do update set
    guide_quiz_id = excluded.guide_quiz_id,
    selected_answer = excluded.selected_answer,
    quiz_passed = public.guide_completions.quiz_passed or excluded.quiz_passed,
    xp_awarded = greatest(public.guide_completions.xp_awarded, excluded.xp_awarded),
    completed_at = coalesce(public.guide_completions.completed_at, excluded.completed_at),
    updated_at = now();

  if passed then
    perform public.check_and_award_course_badges(auth.uid());
  end if;

  select p.total_xp, p.level
  into next_profile
  from public.profiles as p
  where p.id = auth.uid();

  xp_awarded := inserted_amount;
  total_xp := coalesce(next_profile.total_xp, 0);
  level := coalesce(next_profile.level, 1);
  already_awarded := has_existing_award or (passed and inserted_amount = 0);
  correct_answer := null;
  explanation := case
    when passed and inserted_amount > 0 then 'All five guide quiz answers were correct. XP has been awarded.'
    when passed then 'All five guide quiz answers were correct. XP was already awarded for this guide.'
    else 'Review the guide and each explanation, then try the five-question quiz again.'
  end;

  return next;
end;
$$;

grant execute on function public.get_guide_quiz(uuid) to anon, authenticated;
grant execute on function public.submit_guide_quiz(uuid, jsonb) to authenticated;
grant execute on function public.ensure_guide_quiz_question_count(uuid) to anon, authenticated;

select public.ensure_guide_quiz_question_count(g.id)
from public.guides as g
where g.is_archived = false;
