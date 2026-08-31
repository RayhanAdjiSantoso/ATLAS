import { asyncHandler } from '../utils/errors.js';
import * as metaAutomationService from '../services/metaAutomationService.js';

export const getAccounts = asyncHandler(async (req, res) => {
  const accounts = await metaAutomationService.callAppsScript('accounts');
  res.json({ accounts });
});

export const getLog = asyncHandler(async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const log = await metaAutomationService.callAppsScript('log', { limit });
  res.json({ log });
});

export const weeklyRun = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('weeklyRun');
  res.json({ result });
});

export const weeklyCheckTokens = asyncHandler(async (req, res) => {
  const tokens = await metaAutomationService.callAppsScript('weeklyCheckTokens');
  res.json({ tokens });
});

export const dailyRun = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('dailyRun');
  res.json({ result });
});

export const dailyResetCooldown = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('dailyResetCooldown');
  res.json({ result });
});

export const trackingList = asyncHandler(async (req, res) => {
  const configs = await metaAutomationService.callAppsScript('trackingList');
  res.json({ configs });
});

export const trackingCreate = asyncHandler(async (req, res) => {
  const savedConfig = await metaAutomationService.callAppsScript('trackingSave', req.body);
  res.status(201).json({ config: savedConfig });
});

export const trackingUpdate = asyncHandler(async (req, res) => {
  const savedConfig = await metaAutomationService.callAppsScript('trackingSave', { ...req.body, id: req.params.id });
  res.json({ config: savedConfig });
});

export const trackingDelete = asyncHandler(async (req, res) => {
  const configs = await metaAutomationService.callAppsScript('trackingDelete', { id: req.params.id });
  res.json({ configs });
});

export const trackingPreview = asyncHandler(async (req, res) => {
  const preview = await metaAutomationService.callAppsScript('trackingPreview', { id: req.params.id });
  res.json({ preview });
});

export const trackingRunAll = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('trackingRunAll');
  res.json({ result });
});

// --- Alur 1: Brand (kredensial ad account, tanpa setelan notifikasi) ---

export const brandList = asyncHandler(async (req, res) => {
  const brands = await metaAutomationService.callAppsScript('brandList');
  res.json({ brands });
});

export const brandCreate = asyncHandler(async (req, res) => {
  const brand = await metaAutomationService.callAppsScript('brandSave', req.body);
  res.status(201).json({ brand });
});

export const brandUpdate = asyncHandler(async (req, res) => {
  const brand = await metaAutomationService.callAppsScript('brandSave', { ...req.body, id: req.params.id });
  res.json({ brand });
});

export const brandDelete = asyncHandler(async (req, res) => {
  const result = await metaAutomationService.callAppsScript('brandDelete', { id: req.params.id });
  res.json(result);
});

// --- Alur 2: Langganan (siapa dinotifikasi, metrik & threshold) ---

export const subscriptionList = asyncHandler(async (req, res) => {
  const subscriptions = await metaAutomationService.callAppsScript('subscriptionList');
  res.json({ subscriptions });
});

export const subscriptionCreate = asyncHandler(async (req, res) => {
  const subscription = await metaAutomationService.callAppsScript('subscriptionSave', req.body);
  res.status(201).json({ subscription });
});

export const subscriptionUpdate = asyncHandler(async (req, res) => {
  const subscription = await metaAutomationService.callAppsScript('subscriptionSave', { ...req.body, id: req.params.id });
  res.json({ subscription });
});

export const subscriptionDelete = asyncHandler(async (req, res) => {
  const subscriptions = await metaAutomationService.callAppsScript('subscriptionDelete', { id: req.params.id });
  res.json({ subscriptions });
});
