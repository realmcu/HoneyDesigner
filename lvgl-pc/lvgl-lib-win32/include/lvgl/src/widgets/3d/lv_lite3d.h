/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * @file lv_lite3d.h
 *
 */

#ifndef LV_LITE3D_H
#define LV_LITE3D_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../core/lv_obj_private.h"
#include "../../libs/Lite3D/include/l3.h"

#if LV_USE_LITE3D != 0
/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/
typedef void (*lv_lite3d_click_cb_t)(void *obj);

typedef struct
{
    lv_obj_t obj; /*Base object*/
    l3_model_base_t *model; /*3D model*/
    bool need_refresh; /*Indicate whether the 3D model need refresh*/
    lv_lite3d_click_cb_t click_callback;
} lv_lite3d_t;


LV_ATTRIBUTE_EXTERN_DATA extern const lv_obj_class_t lv_lite3d_class;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**
 * Create a 3dtexture object
 * @param parent    pointer to an object, it will be the parent of the new 3dtexture
 * @param model     3D model

 * @return          pointer to the created 3dtexture
 */
lv_obj_t *lv_lite3d_create(lv_obj_t *parent, l3_model_base_t *model);

/**
 * Set click callback for the 3dtexture object
 * @param obj       pointer to a 3dtexture object
 * @param callback  pointer to the click callback function
 */
void lv_lite3d_set_click_cb(lv_obj_t *obj, lv_lite3d_click_cb_t callback);
/*=======================
 * Getter functions
 *======================*/


/*=======================
 * Other functions
 *======================*/


/**********************
 *      MACROS
 **********************/

#endif

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_LITE3D_H*/
