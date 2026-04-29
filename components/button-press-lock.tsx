'use client';

import { useEffect } from 'react';

const DEFAULT_CLICK_LOCK_MS = 900;
const QUANTITY_CLICK_LOCK_MS = 275;
const SUBMIT_CLICK_LOCK_MS = 1500;
const FORM_SUBMIT_LOCK_MS = 8000;

const buttonTimers = new WeakMap<HTMLButtonElement, number>();
const formTimers = new WeakMap<HTMLFormElement, number>();
const actionTimers = new Map<string, number>();

function buttonLockDuration(button: HTMLButtonElement) {
  const customDuration = Number(button.dataset.pressLockMs);
  if (Number.isFinite(customDuration) && customDuration >= 0) return customDuration;

  if (button.classList.contains('quantity-stepper-button')) return QUANTITY_CLICK_LOCK_MS;
  if ((button.getAttribute('type') ?? 'submit').toLowerCase() === 'submit') return SUBMIT_CLICK_LOCK_MS;
  return DEFAULT_CLICK_LOCK_MS;
}

function normalizedText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function elementPositionKey(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return [
    Math.round((rect.left + window.scrollX) / 8),
    Math.round((rect.top + window.scrollY) / 8),
    Math.round(rect.width / 8),
    Math.round(rect.height / 8),
  ].join(':');
}

function buttonActionKey(button: HTMLButtonElement) {
  const customKey = button.dataset.pressLockKey;
  if (customKey) return customKey;

  return [
    window.location.pathname,
    'button',
    button.type,
    button.name,
    button.value,
    normalizedText(button.getAttribute('aria-label') || button.textContent),
    elementPositionKey(button),
  ].join('|');
}

function formActionKey(form: HTMLFormElement) {
  return [
    window.location.pathname,
    'form',
    form.method,
    form.getAttribute('action') ?? '',
    elementPositionKey(form),
  ].join('|');
}

function isActionLocked(key: string) {
  return actionTimers.has(key);
}

function lockAction(key: string, duration: number) {
  if (duration <= 0) return;
  const currentTimer = actionTimers.get(key);
  if (currentTimer) window.clearTimeout(currentTimer);

  const timer = window.setTimeout(() => {
    actionTimers.delete(key);
  }, duration);
  actionTimers.set(key, timer);
}

function unlockAction(key: string) {
  const currentTimer = actionTimers.get(key);
  if (currentTimer) window.clearTimeout(currentTimer);
  actionTimers.delete(key);
}

function lockButton(button: HTMLButtonElement, duration: number) {
  if (duration <= 0 || button.dataset.pressLock === 'off') return;

  const currentTimer = buttonTimers.get(button);
  if (currentTimer) window.clearTimeout(currentTimer);

  if (!button.dataset.pressLockHadAriaDisabled) {
    const existingAriaDisabled = button.getAttribute('aria-disabled');
    button.dataset.pressLockHadAriaDisabled = existingAriaDisabled === null ? 'false' : 'true';
    if (existingAriaDisabled !== null) button.dataset.pressLockPreviousAriaDisabled = existingAriaDisabled;
  }

  button.dataset.pressLocked = 'true';
  button.setAttribute('aria-disabled', 'true');
  button.classList.add('is-press-locked');

  const timer = window.setTimeout(() => unlockButton(button), duration);
  buttonTimers.set(button, timer);
}

function unlockButton(button: HTMLButtonElement) {
  const currentTimer = buttonTimers.get(button);
  if (currentTimer) window.clearTimeout(currentTimer);
  buttonTimers.delete(button);

  delete button.dataset.pressLocked;
  button.classList.remove('is-press-locked');

  if (button.dataset.pressLockHadAriaDisabled === 'true') {
    button.setAttribute('aria-disabled', button.dataset.pressLockPreviousAriaDisabled ?? 'false');
  } else {
    button.removeAttribute('aria-disabled');
  }
  delete button.dataset.pressLockHadAriaDisabled;
  delete button.dataset.pressLockPreviousAriaDisabled;
}

function lockFormSubmitButtons(form: HTMLFormElement, submitter: HTMLElement | null) {
  const submitButtons = new Set<HTMLButtonElement>();
  form.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])').forEach((button) => {
    submitButtons.add(button);
  });
  if (submitter instanceof HTMLButtonElement) submitButtons.add(submitter);
  submitButtons.forEach((button) => lockButton(button, FORM_SUBMIT_LOCK_MS));
  return submitButtons;
}

export function ButtonPressLock() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (!(event.target instanceof Element)) return;

      const button = event.target.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.disabled || button.dataset.pressLock === 'off') return;

      const actionKey = buttonActionKey(button);
      const duration = buttonLockDuration(button);
      if (button.dataset.pressLocked === 'true' || isActionLocked(actionKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      lockAction(actionKey, duration);
      lockButton(button, duration);
      window.setTimeout(() => {
        if (!event.defaultPrevented) return;
        unlockAction(actionKey);
        if (button.isConnected) unlockButton(button);
      }, 0);
    };

    const handleSubmit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const form = event.target;
      const actionKey = formActionKey(form);

      if (form.dataset.submitLocked === 'true' || isActionLocked(actionKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      lockAction(actionKey, FORM_SUBMIT_LOCK_MS);
      form.dataset.submitLocked = 'true';
      const lockedSubmitButtons = lockFormSubmitButtons(form, event.submitter);

      const currentTimer = formTimers.get(form);
      if (currentTimer) window.clearTimeout(currentTimer);
      const timer = window.setTimeout(() => {
        delete form.dataset.submitLocked;
        formTimers.delete(form);
      }, FORM_SUBMIT_LOCK_MS);
      formTimers.set(form, timer);

      window.setTimeout(() => {
        if (!event.defaultPrevented || !form.isConnected) return;
        unlockAction(actionKey);
        delete form.dataset.submitLocked;
        const latestTimer = formTimers.get(form);
        if (latestTimer) window.clearTimeout(latestTimer);
        formTimers.delete(form);
        lockedSubmitButtons.forEach((button) => unlockButton(button));
      }, 0);
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', handleSubmit, true);
    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('submit', handleSubmit, true);
    };
  }, []);

  return null;
}
